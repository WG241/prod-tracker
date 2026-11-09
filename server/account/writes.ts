import { createHash } from 'node:crypto'
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.ts'
import type { EmailPreferenceInput, PasswordInput, PasswordReceipt, PreferenceReceipt } from '../../src/features/profile/contracts.ts'
import { credentialAccount } from '../auth/credential.ts'
import { AuthFailure } from '../auth/errors.ts'
import type { AuthService } from '../auth/service.ts'
import { lockOwner, owner, withKnownRollbackRetry } from '../auth/owner-write.ts'
import type { Actor } from '../auth/owner-write.ts'
import { recordPasswordChanged } from '../notifications/events.ts'
import { requestEmailPass } from '../email/worker.ts'
import { AccountFailure } from './validation.ts'

function storedPreferenceReceipt(value: Prisma.JsonValue, requestId: string): PreferenceReceipt {
  const result = value as PreferenceReceipt | null
  if (result?.version !== 1 || result.operation !== 'EMAIL_PREFERENCE' || result.requestId !== requestId
    || typeof result.changed !== 'boolean' || !Number.isFinite(Date.parse(result.appliedAt))
    || typeof result.preference?.emailRemindersEnabled !== 'boolean' || !Number.isInteger(result.preference.revision)
    || result.preference.revision < 0) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  return result
}

export function savePreference(db: PrismaClient, actor: Actor, requestId: string, input: EmailPreferenceInput) {
  const operation = 'EMAIL_PREFERENCE'
  const requestHash = createHash('sha256').update(JSON.stringify({ operation, emailRemindersEnabled: input.emailRemindersEnabled, expectedRevision: input.expectedRevision })).digest('hex')
  return withKnownRollbackRetry(db, async (tx) => {
    await lockOwner(tx, actor, 'preference')
    const { staff, at, userId } = await owner(tx, actor)
    const previous = await tx.sharedMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } } })
    if (previous) {
      if (previous.operation !== operation || previous.requestHash !== requestHash) {
        throw new AccountFailure('KEY_CONFLICT', 409, 'This request was already used for a different change.')
      }
      return { ...storedPreferenceReceipt(previous.result, requestId), replayed: true }
    }
    const stored = await tx.notificationPreference.findUnique({ where: { userId }, select: { emailRemindersEnabled: true, revision: true } })
    const current = stored ?? { emailRemindersEnabled: staff.person.emailRemindersEnabled, revision: 0 }
    if (input.expectedRevision !== current.revision) {
      throw new AccountFailure('STALE_PREFERENCE', 409, 'Your email preference changed elsewhere. Reload the latest value.')
    }
    const changed = input.emailRemindersEnabled !== current.emailRemindersEnabled
    if (changed && current.revision >= 2147483647) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
    const preference = changed ? { emailRemindersEnabled: input.emailRemindersEnabled, revision: current.revision + 1 } : current
    if (changed) {
      if (stored) await tx.notificationPreference.update({ where: { userId }, data: { ...preference, updatedAt: at } })
      else await tx.notificationPreference.create({ data: { userId, ...preference, createdAt: at, updatedAt: at } })
      await tx.auditEvent.create({ data: {
        actorId: userId, action: 'account.email_preference.changed', targetType: 'NotificationPreference', targetId: userId,
        before: current, after: preference, createdAt: at,
      } })
    }
    const result: PreferenceReceipt = { version: 1, operation, requestId, appliedAt: at.toISOString(), changed, preference }
    await tx.sharedMutationReceipt.create({ data: { userId, requestId, operation, requestHash, result, createdAt: at } })
    return { ...result, replayed: false }
  })
}

let passwordOperations = 0

export async function changePassword(db: PrismaClient, service: AuthService, actor: Actor, requestId: string, input: PasswordInput) {
  if (passwordOperations >= 2) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
  passwordOperations++
  try {
    const passwords = await service.passwordTools()
    const hash = await passwords.hash(input.newPassword)
    const committed = await withKnownRollbackRetry(db, async (tx) => {
      await lockOwner(tx, actor, 'password')
      const { userId } = await owner(tx, actor)
      if (await tx.sharedMutationReceipt.findUnique({ where: { userId_requestId: { userId, requestId } }, select: { requestId: true } })) {
        throw new AccountFailure('CONSUMED_COMMAND', 409, 'This password request was already used.')
      }
      const credential = await credentialAccount(tx, userId)
      if (!credential?.password) throw new AccountFailure('CREDENTIAL_UNAVAILABLE', 403, 'Contact HR to change your password.')
      if (!await passwords.verify({ hash: credential.password, password: input.currentPassword })) {
        throw new AccountFailure('INVALID_CURRENT_PASSWORD', 400, 'Check your current password.', { currentPassword: 'Your current password is incorrect.' })
      }
      if (await passwords.verify({ hash: credential.password, password: input.newPassword })) {
        throw new AccountFailure('PASSWORD_REUSED', 400, 'Choose a different password.', { newPassword: 'Choose a password different from your current password.' })
      }
      const { at } = await owner(tx, actor)
      await tx.authAccount.update({ where: { id: credential.id }, data: { password: hash, updatedAt: at } })
      const { count } = await tx.authSession.deleteMany({ where: { userId } })
      if (await tx.authSession.count({ where: { userId } })) throw new AuthFailure('SERVICE_UNAVAILABLE', 503)
      const result: PasswordReceipt = {
        version: 1, operation: 'PASSWORD_CHANGE', requestId, appliedAt: at.toISOString(), changed: true, reauthRequired: true,
      }
      await recordPasswordChanged(tx, userId, requestId, at)
      await tx.auditEvent.create({ data: {
        actorId: userId, action: 'account.password.changed', targetType: 'AuthAccount', targetId: credential.id,
        after: { requestId, appliedAt: result.appliedAt, operation: result.operation, sessionCount: count }, createdAt: at,
      } })
      await tx.sharedMutationReceipt.create({ data: { userId, requestId, operation: result.operation, result, createdAt: at } })
      return result
    })
    requestEmailPass()
    return committed
  } finally { passwordOperations-- }
}

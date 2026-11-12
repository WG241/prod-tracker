import 'dotenv/config'
import { parseArgs } from 'node:util'
import { EmailState } from '../src/generated/prisma/client.ts'
import { requireOperatorDatabase } from '../server/auth/operator-target.ts'
import { readConfig } from '../server/config.ts'
import { createDatabase } from '../server/db.ts'
import { readEmailConfig } from '../server/email/config.ts'
import { retryFailedEmail } from '../server/email/queue.ts'

const [command, ...args] = process.argv.slice(2)
const knownKinds = new Set(['PASSWORD_CHANGED', 'APPROVAL_REQUESTED', 'LEAVE_RECORDED', 'LEAVE_CANCELLED', 'LEAVE_RETURNED'])
const knownReasons = new Set(['MAIL_DISABLED', 'MAIL_CONFIGURATION_INVALID', 'RECIPIENT_UNAVAILABLE', 'PREFERENCE_DISABLED', 'RELATIONSHIP_CHANGED',
  'EVENT_INELIGIBLE', 'ON_LEAVE', 'DOMAIN_NOT_ALLOWED', 'MESSAGE_INVALID', 'EXPIRED', 'RETRY_EXHAUSTED', 'TRANSPORT_CHANGED', 'BASIS_INVALID',
  'PROVIDER_RETRY', 'PROVIDER_REJECTED', 'PAYLOAD_CONFLICT', 'ACCEPTANCE_UNKNOWN', 'PREVIEW_WRITE_FAILED'])

async function main() {
  const connection = readConfig().connectionString
  requireOperatorDatabase(connection)
  const db = createDatabase(connection)
  try {
    if (command === 'inspect') {
      const { values } = parseArgs({ args, options: { state: { type: 'string' }, limit: { type: 'string' }, oldest: { type: 'boolean' } } })
      const state = values.state as EmailState | undefined
      const limit = values.limit ?? '25'
      if ((state && !Object.hasOwn(EmailState, state)) || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100) throw new Error('Invalid inspect options')
      const rows = await db.emailDelivery.findMany({ where: { state }, take: Number(limit), orderBy: values.oldest
        ? [{ enqueuedAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]
        : [{ scheduledAt: 'desc' }, { id: 'desc' }], select: {
        id: true, state: true, attemptCount: true, enqueuedAt: true, scheduledAt: true, lastAttemptAt: true,
        firstUncertainAt: true, sentAt: true, failureCode: true, notification: { select: { kind: true } },
      } })
      console.log(JSON.stringify(rows.map(({ notification, failureCode, ...row }) => ({ ...row,
        kind: knownKinds.has(notification.kind) ? notification.kind : 'LEGACY',
        reason: failureCode ? knownReasons.has(failureCode) ? failureCode : 'LEGACY_REASON' : null,
      })), null, 2))
      return
    }
    if (command !== 'retry') throw new Error('Unknown command')
    const { values } = parseArgs({ args, options: { 'delivery-id': { type: 'string' }, apply: { type: 'boolean' } } })
    const id = values['delivery-id']
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid delivery id')
    const apply = values.apply === true
    const eligible = await retryFailedEmail(db, id, readEmailConfig(), apply)
    if (!eligible) console.info('Delivery is ineligible for retry.')
    else console.info(apply ? 'Delivery queued.' : 'Delivery is eligible. Use --apply to queue it.')
  } finally { await db.$disconnect() }
}

main().catch(() => { console.error('Email operator command failed. Check the command options and database configuration.'); process.exitCode = 1 })

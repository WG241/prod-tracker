import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { readEmailConfig } from './config.ts'
import { hasPreviewDirectory, persistPreview, prunePreviews } from './preview.ts'
import { claimEmail, dispatchConfigurationMatches, settleEmail, stillDispatchable } from './queue.ts'
import type { MailDiagnostic } from './queue.ts'
import { sendResend } from './resend.ts'
import type { SendOutcome } from './resend.ts'

let notifyWorker: (() => void) | undefined
export function requestEmailPass() { notifyWorker?.() }

const diagnosticAt = new Map<MailDiagnostic, number>()
function diagnostic(code: MailDiagnostic) {
  const at = performance.now()
  if (at - (diagnosticAt.get(code) ?? -Infinity) < 60000) return
  diagnosticAt.set(code, at)
  console.error(JSON.stringify({ code, source: 'background', location: 'email-delivery' }))
}

const pause = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds).unref())

export function startEmailWorker(db: PrismaClient) {
  let active: Promise<void> | undefined
  let wakePending = false
  let stopped = false
  let lastExternal = -Infinity
  let reportedInvalid = false

  const withPreviewLock = <T>(action: () => Promise<T>) => db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(734509) IS NULL AS acquired`
    return action()
  }, { maxWait: 5000, timeout: 10000 })

  async function pass() {
    const config = readEmailConfig()
    const deadline = performance.now() + 20000
    try { if (await hasPreviewDirectory()) await withPreviewLock(() => prunePreviews()) }
    catch { diagnostic('EMAIL_DELIVERY_FAILED') }
    if (config.mode === 'off') return
    if (config.mode === 'invalid' && !reportedInvalid) diagnostic('EMAIL_CONFIGURATION_INVALID')
    reportedInvalid = config.mode === 'invalid'
    for (let admitted = 0; admitted < 10 && !stopped && performance.now() < deadline; admitted++) {
      if (config.mode === 'catch-all' || config.mode === 'live') {
        const delay = 1000 - (performance.now() - lastExternal)
        if (delay > 0) await pause(delay)
        if (stopped || performance.now() >= deadline) return
      }
      const pick = await claimEmail(db, config)
      if (!pick) return
      if (!pick.claim) { if (pick.diagnostic) diagnostic(pick.diagnostic); continue }
      const { claim } = pick
      if (!await stillDispatchable(db, claim) || !dispatchConfigurationMatches(claim)) continue
      let outcome: SendOutcome
      if (claim.config.mode === 'preview') {
        try {
          await withPreviewLock(() => persistPreview(claim.row.id, claim.message))
          outcome = { kind: 'previewed' }
        } catch { outcome = { kind: 'failed', code: 'PREVIEW_WRITE_FAILED' } }
      } else {
        lastExternal = performance.now()
        outcome = await sendResend(claim.config.apiKey, claim.row.providerKey!, claim.message)
      }
      const failure = await settleEmail(db, claim, outcome)
      if (failure) diagnostic(failure)
    }
  }

  function wake() {
    if (stopped) return
    if (active) { wakePending = true; return }
    active = Promise.resolve().then(pass).catch(() => diagnostic('EMAIL_DELIVERY_FAILED')).finally(() => {
      active = undefined
      if (wakePending) { wakePending = false; wake() }
    })
  }
  const timer = setInterval(wake, 30000).unref()
  notifyWorker = wake
  wake()
  return async () => {
    stopped = true
    clearInterval(timer)
    if (notifyWorker === wake) notifyWorker = undefined
    if (active) await Promise.race([active, pause(12000)])
  }
}

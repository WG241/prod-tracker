import { createHash } from 'node:crypto'
import { wellFormed } from '../../src/features/auth/contracts.ts'
import { canonicalMailbox, destinationFor } from './config.ts'
import type { ActiveEmailConfig } from './config.ts'

export type MessageSnapshot = { version: 1; from: string; to: string; subject: string; text: string; workspaceUrl: string }

export function payloadHash(message: MessageSnapshot) {
  const { from, to, subject, text, workspaceUrl } = message
  return createHash('sha256').update(JSON.stringify({ from, to, subject, text, workspaceUrl })).digest('hex')
}

export function composeMessage(config: ActiveEmailConfig, address: string, { title, body }: { title: string; body: string }): MessageSnapshot | null {
  const to = destinationFor(config, address)
  if (!to || canonicalMailbox(to) !== to) return null
  const subject = `Workforce weekly performance: ${title}`
  const text = `${title}\n\n${body}\n\nOpen Workforce: ${config.workspaceUrl}\n`
  const message = { version: 1 as const, from: config.from, to, subject, text, workspaceUrl: config.workspaceUrl }
  if (/[\r\n\0]/.test(subject) || text.includes('\0') || !wellFormed(subject) || !wellFormed(text)
    || [...subject].length > 200 || [...text].length > 8000 || Buffer.byteLength(JSON.stringify(message)) > 32768) return null
  return message
}

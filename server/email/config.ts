import { isLoopback } from '../auth/config.ts'

type Preview = { mode: 'preview'; from: string; workspaceUrl: string; revision: null }
type External = { from: string; workspaceUrl: string; revision: string; apiKey: string } & (
  | { mode: 'catch-all'; destination: string }
  | { mode: 'live'; domains: ReadonlySet<string> }
)
export type ActiveEmailConfig = Preview | External
export type EmailConfig = ActiveEmailConfig | { mode: 'off' } | { mode: 'invalid' }

function domainName(value: string) {
  return value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(value)
}

export function canonicalMailbox(value: string | undefined) {
  if (!value || /[\r\n\0]/.test(value)) return null
  const address = value.trim().toLowerCase()
  const [local, domain, extra] = address.split('@')
  return address.length <= 254 && local.length <= 64 && extra === undefined && domain && domainName(domain)
    && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local) ? address : null
}

function externalDomain(domain: string) {
  return domainName(domain) && !/(?:^|\.)(?:example|invalid|test|localhost)$/.test(domain)
    && !/(?:^|\.)example\.(?:com|net|org)$/.test(domain)
}

export function readEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const mode = env.EMAIL_MODE ?? 'off'
  if (mode === 'off') return { mode }
  const invalid = { mode: 'invalid' } as const
  if (mode !== 'preview' && mode !== 'catch-all' && mode !== 'live') return invalid
  const from = canonicalMailbox(env.EMAIL_FROM)
  let url: URL
  try { url = new URL(env.BETTER_AUTH_URL ?? '') } catch { return invalid }
  if (!from || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url.hostname)))) return invalid
  const workspaceUrl = `${url.origin}/`
  if (mode === 'preview') return { mode, from, workspaceUrl, revision: null }
  const revision = env.EMAIL_TRANSPORT_REVISION ?? '', apiKey = env.RESEND_API_KEY ?? ''
  if (!externalDomain(from.split('@')[1]) || !/^[A-Za-z0-9._-]{1,80}$/.test(revision) || !/^re_[A-Za-z0-9_-]{8,}$/.test(apiKey)) return invalid
  if (mode === 'catch-all') {
    const destination = canonicalMailbox(env.EMAIL_CATCH_ALL_TO)
    return destination && externalDomain(destination.split('@')[1]) ? { mode, from, workspaceUrl, revision, apiKey, destination } : invalid
  }
  const domains = (env.EMAIL_LIVE_ALLOWED_DOMAINS ?? '').split(',').map((value) => value.trim().toLowerCase())
  if (env.EMAIL_LIVE_ENABLED !== 'true' || env.NODE_ENV !== 'production' || url.protocol !== 'https:' || isLoopback(url.hostname)
    || env.EMAIL_CATCH_ALL_TO || !domains.every(externalDomain)) return invalid
  return { mode, from, workspaceUrl, revision, apiKey, domains: new Set(domains) }
}

export function destinationFor(config: ActiveEmailConfig, address: string) {
  if (config.mode === 'catch-all') return config.destination
  if (config.mode === 'live' && !config.domains.has(address.split('@')[1])) return null
  return address
}

import { isIP } from 'node:net'
import type { Request } from 'express'

const serviceHosts = new Set(['127.0.0.1', 'localhost', '::1'])
const databaseHosts = new Set(['127.0.0.1', 'localhost', '[::1]'])

export function localProofConnection(connectionString: string) {
  try {
    const url = new URL(connectionString)
    return ['postgres:', 'postgresql:'].includes(url.protocol) && databaseHosts.has(url.hostname)
      && !Array.from(url.searchParams.keys()).some((key) => ['host', 'hostaddr', 'service'].includes(key.toLowerCase()))
  } catch { return false }
}

export function proofAvailable(config: { development: boolean; host: string; connectionString: string }) {
  return config.development && serviceHosts.has(config.host) && localProofConnection(config.connectionString)
}

function loopbackSocket(address: string | undefined) {
  if (!address) return false
  if (address === '::1') return true
  if (isIP(address) === 4) return address.startsWith('127.')
  if (isIP(address) !== 6) return false
  return /^::ffff:127\./i.test(address) || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/i.test(address)
}

export function proofRequestAllowed(request: Request, port: number) {
  if (!loopbackSocket(request.socket.remoteAddress)) return false
  const host = request.headers.host
  if (!host || /[\s/@?#\\]/.test(host)) return false
  try {
    const url = new URL(`http://${host}`)
    if (!databaseHosts.has(url.hostname) || Number(url.port || 80) !== port) return false
    const origin = request.headers.origin
    if (origin !== undefined && origin !== url.origin) return false
    if (request.method === 'POST') {
      if (origin !== url.origin) return false
      const fetchSite = request.headers['sec-fetch-site']
      if (fetchSite !== undefined && fetchSite !== 'same-origin') return false
    }
    return true
  } catch { return false }
}

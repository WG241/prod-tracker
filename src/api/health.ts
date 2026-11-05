export async function checkConnection() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store', signal: AbortSignal.timeout(10000) })
    const result: unknown = await response.json()
    if (response.ok && typeof result === 'object' && result !== null
      && 'status' in result && result.status === 'ok'
      && 'database' in result && result.database === 'connected') {
      console.info('Workforce API and database connected')
    } else {
      console.warn('Workforce API or database unavailable')
    }
  } catch {
    console.warn('Workforce connection check unavailable')
  }
}

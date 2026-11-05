import { useEffect, useRef, useState } from 'react'
import type { ReadClock } from './contracts.ts'

class ReadFailure extends Error {}

export const EMPLOYEE_READ_TIMEOUT_MS = 20_000

/** Bounded fetch init so a stalled HTTP body reaches Retry instead of loading forever. */
export function employeeReadInit(signal: AbortSignal, timeoutMs = EMPLOYEE_READ_TIMEOUT_MS): RequestInit {
  return {
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    credentials: 'same-origin',
    cache: 'no-store',
  }
}

export function useEmployeeRead<T extends ReadClock>(url: string | null, onSessionInvalid: () => void) {
  const [result, setResult] = useState<{ url: string | null; data: T | null; loading: boolean; error: string; stale: boolean }>({ url: null, data: null, loading: true, error: '', stale: false })
  const [revision, setRevision] = useState(0)
  const sequence = useRef(0)
  const invalid = useRef(onSessionInvalid)
  useEffect(() => { invalid.current = onSessionInvalid }, [onSessionInvalid])
  useEffect(() => {
    const version = ++sequence.current
    if (!url) return
    const controller = new AbortController()
    void (async () => {
      await Promise.resolve()
      if (controller.signal.aborted) return
      setResult((old) => ({ url, data: old.url === url ? old.data : null, loading: true, error: '', stale: old.url === url && !!old.data }))
      try {
        const response = await fetch(url, employeeReadInit(controller.signal))
        if (controller.signal.aborted || sequence.current !== version) return
        if (response.status === 401 || response.status === 403) {
          setResult({ url, data: null, loading: false, error: '', stale: false })
          invalid.current()
          return
        }
        if (!response.ok) throw new ReadFailure(response.status === 404 ? 'This task is not available.' : 'The service is unavailable. Please try again.')
        const data = await response.json() as T
        if (!controller.signal.aborted && sequence.current === version) setResult({ url, data, loading: false, error: '', stale: false })
      } catch (error) {
        const aborted = error instanceof DOMException && error.name === 'AbortError'
        if (!aborted && sequence.current === version) setResult((old) => ({ ...old, loading: false, stale: !!old.data, error: error instanceof ReadFailure ? error.message : 'The service is unavailable. Please try again.' }))
      }
    })()
    return () => controller.abort()
  }, [url, revision])
  const data = result.url === url ? result.data : null
  useEffect(() => {
    if (!data || !url) return
    const deadline = Date.parse(data.nextChangeAt)
    let timer: number
    const schedule = () => {
      const remaining = deadline - Date.now()
      if (remaining <= 0) { setRevision((r) => r + 1); return }
      timer = window.setTimeout(schedule, Math.min(remaining + 20, 2147483647))
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [data, url])
  return { data, loading: result.url !== url || result.loading, error: result.url === url ? result.error : '', stale: result.url === url && result.stale, retry: () => setRevision((r) => r + 1) }
}

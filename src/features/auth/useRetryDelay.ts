import { useCallback, useEffect, useState } from 'react'

export function useRetryDelay() {
  const [until, setUntil] = useState(0)
  const [clock, setClock] = useState(0)
  useEffect(() => {
    if (!until) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setClock(now)
      if (now >= until) window.clearInterval(timer)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [until])
  const seconds = Math.max(0, Math.ceil((until - clock) / 1000))
  const start = useCallback((delay: number) => {
    const now = Date.now()
    setClock(now)
    setUntil(delay > 0 ? now + delay * 1000 : 0)
  }, [])
  return { seconds, start }
}

import { useEffect, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { AnnounceEvent } from '../accessibility/Announcements.tsx'

export function NoticeToast({ message, id = `notice:${message}`, expiresAt }: { message: string; id?: string; expiresAt?: number }) {
  const [visible, setVisible] = useState(() => expiresAt === undefined || Date.now() < expiresAt)
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), expiresAt === undefined ? 6000 : Math.max(0, expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [expiresAt])
  return visible ? <><p className="auth-toast"><CircleAlert aria-hidden="true" />{message}</p><AnnounceEvent event={{ id, message, intent: 'status' }} /></> : null
}

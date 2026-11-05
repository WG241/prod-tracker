import { lazy, Suspense } from 'react'
import { AuthApp } from './features/auth/AuthApp.tsx'
import { AnnounceEvent } from './components/accessibility/Announcements.tsx'

const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./dev/DevelopmentApp.tsx')) : null

function PreviewLoading() {
  return <><p className="workspace-loading">Loading preview…</p><AnnounceEvent event={{ id: 'preview-loading', message: 'Loading preview…', intent: 'status' }} /></>
}

function App() {
  if (DevelopmentApp && ['/__ui', '/__data-proof'].includes(window.location.pathname)) return <Suspense fallback={<PreviewLoading />}><DevelopmentApp /></Suspense>
  return <AuthApp />
}

export default App

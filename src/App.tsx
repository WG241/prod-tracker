import { lazy, Suspense } from 'react'
import { AuthApp } from './features/auth/AuthApp.tsx'

const DevelopmentApp = import.meta.env.DEV ? lazy(() => import('./dev/DevelopmentApp.tsx')) : null

function App() {
  if (DevelopmentApp && ['/__ui', '/__data-proof'].includes(window.location.pathname)) return <Suspense fallback={<p role="status" className="workspace-loading">Loading preview…</p>}><DevelopmentApp /></Suspense>
  return <AuthApp />
}

export default App

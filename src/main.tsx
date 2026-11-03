import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { checkConnection } from './api/health.ts'
import { AnnouncementProvider } from './components/accessibility/Announcements.tsx'
import { RecoveryBoundary } from './features/telemetry/RecoveryBoundary.tsx'
import { installBrowserReporting, reportError } from './features/telemetry/client.ts'

installBrowserReporting()
void checkConnection()

createRoot(document.getElementById('root')!, {
  onCaughtError: (error) => reportError('RENDER_ERROR', error),
  onUncaughtError: (error) => reportError('RENDER_ERROR', error),
  onRecoverableError: (error) => reportError('REACT_RECOVERABLE', error),
}).render(
  <StrictMode>
    <RecoveryBoundary><AnnouncementProvider contextKey={window.location.pathname}><App /></AnnouncementProvider></RecoveryBoundary>
  </StrictMode>,
)

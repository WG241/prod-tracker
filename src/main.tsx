import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { checkConnection } from './api/health.ts'
import { AnnouncementProvider } from './components/accessibility/Announcements.tsx'
import { RecoveryBoundary } from './components/RecoveryBoundary.tsx'

void checkConnection()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RecoveryBoundary><AnnouncementProvider contextKey={window.location.pathname}><App /></AnnouncementProvider></RecoveryBoundary>
  </StrictMode>,
)

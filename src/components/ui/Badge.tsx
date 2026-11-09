import type { ReactNode } from 'react'

const statuses: Record<string, { tone: string }> = {
  Pending: { tone: 'neutral' },
  Scheduled: { tone: 'info' },
  'In progress': { tone: 'info' },
  Blocked: { tone: 'danger' },
  'Awaiting approval': { tone: 'warning' },
  Approved: { tone: 'success' },
  Declined: { tone: 'declined' },
  'On hold': { tone: 'hold' },
  Cancelled: { tone: 'neutral' },
  Completed: { tone: 'success' },
  'Returned early': { tone: 'success' },
  'On leave': { tone: 'teal' },
  Submitted: { tone: 'success' },
  'Not submitted': { tone: 'danger' },
  Active: { tone: 'success' },
  Inactive: { tone: 'neutral' },
}

export function Badge({ status, icon }: { status: string; icon?: ReactNode }) {
  const { tone } = statuses[status] ?? { tone: 'neutral' }
  return <span className={`ui-badge ui-badge-${tone}`}>{icon}{status}</span>
}

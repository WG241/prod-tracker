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
  'On leave': { tone: 'teal' },
  Active: { tone: 'success' },
  Inactive: { tone: 'neutral' },
}

export function Badge({ status }: { status: string }) {
  const { tone } = statuses[status] ?? { tone: 'neutral' }
  return <span className={`ui-badge ui-badge-${tone}`}>{status}</span>
}

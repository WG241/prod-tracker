import { CheckCircle2, Circle, Clock, Hourglass, OctagonAlert, Pause, Undo2, Umbrella } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const statuses: Record<string, { tone: string; icon: LucideIcon }> = {
  Pending: { tone: 'neutral', icon: Circle },
  'In progress': { tone: 'info', icon: Clock },
  Blocked: { tone: 'danger', icon: OctagonAlert },
  'Awaiting approval': { tone: 'warning', icon: Hourglass },
  Approved: { tone: 'success', icon: CheckCircle2 },
  Declined: { tone: 'declined', icon: Undo2 },
  'On hold': { tone: 'hold', icon: Pause },
  Cancelled: { tone: 'neutral', icon: Circle },
  'On leave': { tone: 'teal', icon: Umbrella },
  Active: { tone: 'success', icon: CheckCircle2 },
  Inactive: { tone: 'neutral', icon: Circle },
}

export function Badge({ status }: { status: string }) {
  const { tone, icon: Icon } = statuses[status] ?? { tone: 'neutral', icon: Circle }
  return <span className={`ui-badge ui-badge-${tone}`}><Icon aria-hidden="true" />{status}</span>
}

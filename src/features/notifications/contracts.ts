export type NotificationIcon = 'check' | 'calendar' | 'message' | 'security' | 'generic'

export type UnreadSummary = { asOf: string; unreadCount: number }
export type UnreadNotification = {
  id: string
  kind: string
  title: string
  body: string
  createdAt: string
  icon: NotificationIcon
}
export type UnreadPage = UnreadSummary & {
  items: UnreadNotification[]
  page: number
  pageSize: 25
  total: number
  totalPages: number
}

export type NotificationTarget =
  | { kind: 'PROFILE' }
  | { kind: 'EMPLOYEE_LEAVE' }
  | { kind: 'MANAGER_LEAVE' }
  | { kind: 'MANAGER_APPROVALS' }
  | { kind: 'OWN_TASK'; taskId: string; week: string }
  | { kind: 'OWN_TRACKER'; week: string }
  | { kind: 'REVIEW_REQUEST'; requestId: string; taskId: string; week: string }
  | { kind: 'TEAM_TASK'; taskId: string; week: string }
  | { kind: 'UNAVAILABLE'; reason: 'TARGET_UNAVAILABLE' }

export type ReadCommand = { operation: 'NOTIFICATION_READ'; notificationId: string } | { operation: 'NOTIFICATIONS_READ_ALL' }
type Receipt = { version: 1; requestId: string; appliedAt: string; changed: boolean; replayed: boolean }
export type SingleReadResult = { result: Receipt & Extract<ReadCommand, { operation: 'NOTIFICATION_READ' }> & { readAt: string }; unreadCount: number; target: NotificationTarget }
export type BatchReadResult = { result: Receipt & Extract<ReadCommand, { operation: 'NOTIFICATIONS_READ_ALL' }> & { changedCount: number }; unreadCount: number }
export type ReadResult = SingleReadResult | BatchReadResult

export type WorkingStatus = 'PENDING' | 'IN_PROGRESS' | 'BLOCKED' | 'COMPLETED'
export type TaskDraft = { title: string; activity: string; startsOn: string; endsOn: string; carryRequested: boolean; status?: WorkingStatus; blockerReason?: string }
export type TaskOperation =
  | { kind: 'CREATE'; week: string; draft: TaskDraft }
  | { kind: 'EDIT'; taskId: string; revision: number; draft: TaskDraft }
  | { kind: 'STATUS'; taskId: string; revision: number; status: WorkingStatus; blockerReason?: string }
  | { kind: 'CARRY'; taskId: string; revision: number; carryRequested: boolean }
  | { kind: 'DELETE'; taskId: string; revision: number }
  | { kind: 'COMMENT'; taskId: string; body: string }

export type MutationResult = {
  version: 1
  requestId: string
  operation: TaskOperation['kind']
  taskId: string
  taskRevision: number
  continuationId: string | null
  commentId: string | null
  approvalRequestId: string | null
  appliedAt: string
  changed: boolean
  replayed: boolean
}
export type TaskPermissions = {
  canEdit: boolean
  canChangeStatus: boolean
  canComment: boolean
  canCarry: boolean
  canDelete: boolean
  planningFieldsEditable: boolean
  reason: string | null
}

export function operationKey(operation: TaskOperation) {
  return operation.kind === 'CREATE' ? 'CREATE' : `${operation.kind}:${operation.taskId}`
}
export function operationRequest(operation: TaskOperation) {
  const root = '/api/employee/tasks'
  if (operation.kind === 'CREATE') return { path: root, method: 'POST', body: { week: operation.week, ...operation.draft }, revision: undefined }
  const path = `${root}/${encodeURIComponent(operation.taskId)}`
  if (operation.kind === 'COMMENT') return { path: `${path}/comments`, method: 'POST', body: { body: operation.body }, revision: undefined }
  const revision = operation.revision
  switch (operation.kind) {
    case 'EDIT': return { path, method: 'PATCH', body: operation.draft, revision }
    case 'STATUS': return { path: `${path}/status`, method: 'POST', body: { status: operation.status, ...(operation.blockerReason === undefined ? {} : { blockerReason: operation.blockerReason }) }, revision }
    case 'CARRY': return { path: `${path}/carry`, method: 'POST', body: { carryRequested: operation.carryRequested }, revision }
    case 'DELETE': return { path, method: 'DELETE', body: {}, revision }
  }
}

/** Session actor key shared by task and leave operation stores. */
export function sessionActor(userId: string, role: string) {
  return `${userId}:${role}`
}

/** Clear in flight workspace mutations before confirming sign out. */
export function clearWorkspaceOperations(task: { clear(): void }, leave: { clear(): void }) {
  task.clear()
  leave.clear()
}

/**
 * After a failed sign out the session is usually still valid, but clear() emptied
 * each store's actor. Rebind so leave and task sends work again without waiting
 * for a later focus or visibility revalidation.
 */
export function restoreWorkspaceOperations(
  task: { bind(actor: string): void },
  leave: { bind(actor: string): void },
  actor: string,
) {
  task.bind(actor)
  leave.bind(actor)
}

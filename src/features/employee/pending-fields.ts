/**
 * Keep text inputs focusable while a save is pending.
 * Native disabled drops keyboard focus; readOnly blocks edits without that loss.
 */
export function pendingTextProps(locked: boolean): { readOnly?: true } {
  return locked ? { readOnly: true } : {}
}

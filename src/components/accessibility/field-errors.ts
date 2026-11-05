export type FieldErrors<Key extends string> = Partial<Record<Key, string>>

/**
 * Recheck one already invalid field and keep sibling errors.
 * Used when the caller edits a control after submit validation failed.
 */
export function patchFieldError<Key extends string>(
  current: FieldErrors<Key>,
  name: NoInfer<Key>,
  message: string | undefined,
): FieldErrors<Key> {
  if (!current[name]) return current
  return { ...current, [name]: message }
}

import { useId, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useAnnounce } from './useAnnounce.ts'

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
export type FieldErrors<Key extends string> = Partial<Record<Key, string>>
type NamedField<Key extends string> = { name: Key; label: string; ref: RefObject<Control | null> }

export function useFormValidation<Key extends string>({ fields, validate }: {
  fields: NamedField<Key>[]
  validate: () => FieldErrors<Key>
}) {
  const [errors, setErrors] = useState<FieldErrors<Key>>({})
  const pending = useRef<{ errors: FieldErrors<Key>; attempt: number } | null>(null)
  const attempts = useRef(0)
  const id = useId()
  const announce = useAnnounce()
  useLayoutEffect(() => {
    const failed = pending.current
    if (!failed) return
    pending.current = null
    const invalid = fields.filter((field) => failed.errors[field.name] && field.ref.current)
      .sort((a, b) => a.ref.current!.compareDocumentPosition(b.ref.current!) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1)
    const first = invalid[0]
    if (!first) return
    if (document.activeElement === first.ref.current) {
      announce({ id: `${id}:submit:${failed.attempt}`, intent: 'alert', message: `${first.label}. ${failed.errors[first.name]}` })
    } else first.ref.current?.focus()
  })
  const reportErrors = (next: FieldErrors<Key>) => {
    pending.current = { errors: next, attempt: ++attempts.current }
    setErrors({ ...next })
    return !Object.values(next).some(Boolean)
  }
  return {
    errors,
    submit: () => reportErrors(validate()),
    reportErrors,
    clear: () => { pending.current = null; setErrors({}) },
    revalidate: (name: Key) => {
      if (!errors[name]) return
      const next = validate()[name]
      setErrors((current) => ({ ...current, [name]: next }))
    },
  }
}

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { patchFieldError } from '../../src/components/accessibility/field-errors.ts'
import type { FieldErrors } from '../../src/components/accessibility/field-errors.ts'
import { pendingTextProps } from '../../src/features/employee/pending-fields.ts'

test('editing one invalid field keeps sibling field errors (Greptile P2 reproduction)', () => {
  const afterSubmit: FieldErrors<'title' | 'activity'> = {
    title: 'Enter a task title of 1 to 120 characters.',
    activity: 'Enter activity of 1 to 6,000 characters.',
  }
  const clearedAll: FieldErrors<'title' | 'activity'> = {} // former TaskForm change() called validation.clear()
  assert.equal(Object.keys(clearedAll).length, 0, 'clear() would drop the still-invalid activity error')

  const afterTitleFix = patchFieldError(afterSubmit, 'title', undefined)
  assert.equal(afterTitleFix.title, undefined)
  assert.equal(afterTitleFix.activity, 'Enter activity of 1 to 6,000 characters.')

  const stillInvalidTitle = patchFieldError(afterSubmit, 'title', 'Enter a task title of 1 to 120 characters.')
  assert.equal(stillInvalidTitle.title, 'Enter a task title of 1 to 120 characters.')
  assert.equal(stillInvalidTitle.activity, afterSubmit.activity)

  const onlyActivity: FieldErrors<'title' | 'activity'> = { activity: 'Enter activity of 1 to 6,000 characters.' }
  assert.deepEqual(patchFieldError(onlyActivity, 'title', undefined), onlyActivity)
})

test('pending text props use readOnly instead of disabling focus (Greptile P2 reproduction)', () => {
  assert.deepEqual(pendingTextProps(false), {})
  assert.deepEqual(pendingTextProps(true), { readOnly: true })
  assert.equal('disabled' in pendingTextProps(true), false)
})

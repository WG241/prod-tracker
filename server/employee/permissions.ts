import type { TaskStatus } from '../../src/generated/prisma/client.ts'
import type { TaskPermissions } from '../../src/features/employee/mutations.ts'
import type { WeekState } from '../../src/features/employee/contracts.ts'
import { isoDay } from '../data-model/calendar.ts'
import { monday } from './calendar.ts'

export function taskPermissions(status: TaskStatus, snapshotAt: Date | null, week: WeekState | null, asOf: Date): TaskPermissions {
  const current = !!week && week.startsOn === isoDay(monday(asOf)) && Date.parse(week.freezesAt) > asOf.getTime() && !snapshotAt
  const available = current && !week?.pausedForLeave
  const editable = available && status !== 'APPROVED'
  return {
    canEdit: editable, canChangeStatus: editable, canComment: available,
    canCarry: editable && !!week?.planningOpen, canDelete: editable && !!week?.planningOpen,
    planningFieldsEditable: editable && !!week?.planningOpen,
    reason: !current ? 'This is a read only record.' : week?.pausedForLeave ? 'Your tracker is paused while on leave.' : status === 'APPROVED' ? 'Approved tasks cannot be edited, changed or deleted.' : !week?.planningOpen ? 'Planning is closed. Title, dates, carry over and deletion are locked.' : null,
  }
}

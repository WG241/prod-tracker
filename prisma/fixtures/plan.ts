import type { Prisma } from '../../src/generated/prisma/client.ts'
import { AccountStatus, ApprovalState, DecisionKind, DecisionMethod, EmailState, Role, TaskStatus, UnlockScope } from '../../src/generated/prisma/client.ts'
import { activeAt, assignmentForWeek, day, expectedWorkingDays, isoDay, shiftDay, watMidnight } from '../../server/data-model/calendar.ts'
import source from './prototype.json' with { type: 'json' }

const instant = (value: string) => new Date(value)
const createdAt = instant('2025-01-01T00:00:00.000Z')
export const sampleAsOf = instant('2026-10-26T12:00:00.000+01:00')
export const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
export const personId = (name: string) => `person-${slug(name)}`
export const weekId = (startsOn: string) => `week-${startsOn}`
export const trackerId = (name: string, startsOn: string) => `tracker-${slug(name)}-${startsOn}`
export const taskId = (title: string, startsOn = '2026-10-19', owner = '') => `task-${startsOn}-${slug(owner)}-${slug(title)}`

type SourceTask = {
  id: number; title: string; activity: string; start: string; end: string; status: string
  employee: string; carry?: boolean; reason?: string; approvedBy?: string; approvedOn?: string
  comments: { author: string; text: string; time: string }[]
}
type Person = {
  name: string; role: Role; business: string | null; unit: string | null; manager: string | null; department: string | null
}
const roleLabels: Record<string, Role> = {
  Employee: Role.EMPLOYEE, 'Line Manager': Role.LINE_MANAGER, 'Business Director': Role.BUSINESS_DIRECTOR,
  Executive: Role.EXECUTIVE, 'HR / Admin': Role.HR_ADMIN,
}
const statusLabels: Record<string, TaskStatus> = {
  Pending: TaskStatus.PENDING, 'In progress': TaskStatus.IN_PROGRESS, Blocked: TaskStatus.BLOCKED,
  'Awaiting approval': TaskStatus.AWAITING_APPROVAL, Approved: TaskStatus.APPROVED,
  Completed: TaskStatus.APPROVED, Declined: TaskStatus.DECLINED, 'On hold': TaskStatus.ON_HOLD, Cancelled: TaskStatus.CANCELLED,
}

export function createSeedPlan() {
  const corrections: string[] = [
    'Task keys use owner, title and week, preserving the two distinct v1.2 tasks that reused ids 10 and 11.',
    'Approved is canonical; legacy percentages and notSubmitted flags are not persisted.',
    'Emeka is the Outsourcing director. Conflicting historical relief examples use Bayo Adeleke, an eligible Line Manager.',
    'Damilola has a synthetic Week 42 transfer from Nneka/Outsourcing to Tunde/Resourcing, while keeping the current prototype assignment.',
    'Tosin joins partway through Wednesday in Week 43; Grace is deactivated after Week 43 freezes. These are labeled verification scenarios.',
  ]
  const businesses = source.orgStructure.map((business) => ({
    id: `business-${slug(business.name)}`, name: business.name, createdAt,
  })) satisfies Prisma.BusinessCreateManyInput[]
  const units = source.orgStructure.flatMap((business) => business.units.map((name) => ({
    id: `unit-${slug(business.name)}-${slug(name)}`, businessId: `business-${slug(business.name)}`, name, createdAt,
  }))) satisfies Prisma.UnitCreateManyInput[]
  const roster = new Map<string, Person>()
  for (const row of source.seedPeople) roster.set(row[0], {
    name: row[0], role: roleLabels[row[1]], business: row[2], unit: row[3] === '—' ? null : row[3],
    manager: row[4] === '—' ? null : row[4], department: null,
  })
  source.pendingNames.forEach((name, index) => {
    if (roster.has(name)) return
    const resourcing = index === 0 || index % 3 !== 0
    roster.set(name, { name, role: Role.EMPLOYEE,
      business: resourcing ? 'Workforce Resourcing' : 'Outsourcing',
      unit: index % 2 ? 'Assessment' : 'Recruitment', manager: resourcing ? 'Tunde Bakare' : 'Nneka Obi', department: null })
  })
  for (const entry of [
    { name: 'Emeka Nwosu', role: Role.BUSINESS_DIRECTOR, business: 'Outsourcing', unit: null, manager: null, department: null },
    { name: 'Bayo Adeleke', role: Role.LINE_MANAGER, business: 'Outsourcing', unit: 'Background Check', manager: null, department: null },
    { name: 'David Cole', role: Role.EXECUTIVE, business: null, unit: null, manager: null, department: 'Workforce Group' },
    { name: 'Kemi Adebayo', role: Role.HR_ADMIN, business: null, unit: null, manager: null, department: 'People & Culture' },
  ]) roster.set(entry.name, entry)
  for (const person of roster.values()) {
    if (person.business === 'Outsourcing' && person.unit && !source.orgStructure[1].units.includes(person.unit)) {
      corrections.push(`${person.name}: ${person.unit} is a Resourcing unit; use Payroll under Outsourcing, keeping Nneka as manager.`)
      person.unit = 'Payroll'
    }
  }

  const users = [...roster.values()].map((person) => ({
    id: personId(person.name), name: person.name, email: `${person.name.toLowerCase().replaceAll(' ', '.')}@workforcegroup.com`,
    accountStatus: person.name === 'Grace Ekanem' ? AccountStatus.INACTIVE : AccountStatus.ACTIVE,
    deactivatedAt: person.name === 'Grace Ekanem' ? instant('2026-10-26T09:00:00+01:00') : null,
    emailRemindersEnabled: true,
    createdAt: person.name === 'Tosin Ajayi' ? instant('2026-10-21T12:00:00+01:00') : createdAt,
  }))
  const assignments = [...roster.values()].map((person) => ({
    id: `assignment-${slug(person.name)}-current`, userId: personId(person.name), role: person.role,
    businessId: person.business ? `business-${slug(person.business)}` : null,
    unitId: person.unit ? `unit-${slug(person.business!)}-${slug(person.unit)}` : null,
    managerId: person.manager ? personId(person.manager) : null, departmentLabel: person.department,
    effectiveFrom: person.name === 'Damilola James' ? instant('2026-10-14T12:00:00+01:00')
      : person.name === 'Tosin Ajayi' ? instant('2026-10-21T12:00:00+01:00') : createdAt,
    effectiveTo: null as Date | null,
    createdAt: person.name === 'Damilola James' ? instant('2026-10-14T12:00:00+01:00')
      : person.name === 'Tosin Ajayi' ? instant('2026-10-21T12:00:00+01:00') : createdAt,
  }))
  assignments.push({ id: 'assignment-damilola-before-transfer', userId: personId('Damilola James'), role: Role.EMPLOYEE,
    businessId: 'business-outsourcing', unitId: 'unit-outsourcing-payroll', managerId: personId('Nneka Obi'), departmentLabel: null,
    effectiveFrom: createdAt, effectiveTo: instant('2026-10-14T12:00:00+01:00'), createdAt })

  const leaves: Prisma.LeaveRecordCreateManyInput[] = [
    { id: 'leave-femi', userId: personId('Femi Lawson'), startsOn: day('2026-10-19'), expectedReturnOn: day('2026-10-26'), createdAt: instant('2026-10-16T08:00:00Z') },
    { id: 'leave-nneka', userId: personId('Nneka Obi'), startsOn: day('2026-10-19'), expectedReturnOn: day('2026-10-23'), createdAt: instant('2026-10-16T08:00:00Z') },
    { id: 'leave-ada-partial', userId: personId('Ada Okafor'), startsOn: day('2026-10-22'), expectedReturnOn: day('2026-10-23'), createdAt: instant('2026-10-21T08:00:00Z') },
    { id: 'leave-nneka-history-example', userId: personId('Nneka Obi'), startsOn: day('2026-10-12'), expectedReturnOn: day('2026-10-15'), actualReturnOn: day('2026-10-15'), createdAt: instant('2026-10-09T08:00:00Z') },
  ]
  const relief: Prisma.ReliefAssignmentCreateManyInput[] = [
    { id: 'relief-nneka', leaveId: 'leave-nneka', coveredManagerId: personId('Nneka Obi'), reliefManagerId: personId('Tunde Bakare'), startsOn: day('2026-10-19'), endsOn: day('2026-10-23'), createdAt: instant('2026-10-16T09:00:00Z') },
    { id: 'relief-nneka-history-example', leaveId: 'leave-nneka-history-example', coveredManagerId: personId('Nneka Obi'), reliefManagerId: personId('Tunde Bakare'), startsOn: day('2026-10-12'), endsOn: day('2026-10-15'), endedAt: instant('2026-10-15T00:00:00+01:00'), createdAt: instant('2026-10-09T09:00:00Z') },
  ]
  for (const entry of source.defaultPastLeaves) {
    const expectedReturnOn = day(entry.resumptionDate)
    leaves.push({ id: entry.id, userId: personId(entry.name), startsOn: day(entry.start), expectedReturnOn,
      actualReturnOn: day(entry.returnedOn), createdAt: watMidnight(shiftDay(day(entry.start), -3)) })
    if (entry.relief) {
      const officer = entry.relief.name === 'Emeka Nwosu' ? 'Bayo Adeleke' : entry.relief.name
      relief.push({ id: `relief-${entry.id}`, leaveId: entry.id, coveredManagerId: personId(entry.name), reliefManagerId: personId(officer),
        startsOn: day(entry.relief.start), endsOn: expectedReturnOn, endedAt: watMidnight(day(entry.returnedOn)),
        createdAt: watMidnight(shiftDay(day(entry.start), -3)) })
    }
  }
  const weeks = ['2026-10-05','2026-10-12','2026-10-19','2026-10-26'].map((start) => ({
    id: weekId(start), startsOn: day(start),
    planningLocksAt: instant(`${isoDay(shiftDay(day(start), 1))}T14:00:00+01:00`),
    freezesAt: watMidnight(shiftDay(day(start), 5)), createdAt: watMidnight(day(start)),
  }))

  const trackers: Prisma.WeeklyTrackerCreateManyInput[] = []
  for (const week of weeks) for (const person of roster.values()) {
    const user = users.find((record) => record.id === personId(person.name))!
    const periods = assignments.filter((record) => record.userId === user.id)
    const assignment = assignmentForWeek(periods, week.startsOn, week.freezesAt, sampleAsOf)
    if (!assignment) continue
    const reference = new Date(Math.min(sampleAsOf.getTime(), week.freezesAt.getTime() - 1))
    const business = businesses.find((record) => record.id === assignment.businessId)
    const unit = units.find((record) => record.id === assignment.unitId)
    const manager = users.find((record) => record.id === assignment.managerId)
    const frozen = week.freezesAt <= sampleAsOf
    const contextSnapshot = { version: 1, userId: user.id, displayName: user.name, role: assignment.role,
      accountStatus: activeAt(user, reference) ? 'ACTIVE' : 'INACTIVE',
      businessId: business?.id ?? null, businessName: business?.name ?? null,
      unitId: unit?.id ?? null, unitName: unit?.name ?? null,
      managerId: manager?.id ?? null, managerName: manager?.name ?? null, departmentLabel: assignment.departmentLabel }
    const userLeaves = leaves.filter((record) => record.userId === user.id).map((record) => ({
      userId: user.id, startsOn: new Date(record.startsOn), expectedReturnOn: new Date(record.expectedReturnOn),
      actualReturnOn: record.actualReturnOn ? new Date(record.actualReturnOn) : null,
      cancelledAt: record.cancelledAt ? new Date(record.cancelledAt) : null,
    }))
    trackers.push({ id: trackerId(person.name, isoDay(week.startsOn)), userId: user.id, weekId: week.id,
      assignmentId: assignment.id, contextSnapshot,
      expectedWorkingDaysSnapshot: frozen ? expectedWorkingDays(user, periods, userLeaves, week.startsOn, week.freezesAt, sampleAsOf) : null,
      snapshotAt: frozen ? week.freezesAt : null,
      createdAt: new Date(Math.max(watMidnight(week.startsOn).getTime(), user.createdAt.getTime())) })
  }

  const baseTasks: SourceTask[] = [...source.seedTasks,
    { ...source.seedTasks[2], id: 10, title: 'Share the recruitment pipeline summary', activity: 'Share the weekly pipeline summary and interview recommendations.', employee: 'Ada Okafor' },
    { id: 11, title: 'Prepare the recruitment team review', activity: 'Consolidate the team’s priorities and client updates for the weekly review.', start: '2026-10-19', end: '2026-10-23', status: 'In progress', employee: 'Tunde Bakare', carry: false, comments: [] },
  ]
  const series: Prisma.TaskSeriesCreateManyInput[] = []
  const tasks: Prisma.WeeklyTaskCreateManyInput[] = []
  const comments: Prisma.TaskCommentCreateManyInput[] = []
  const requests: Prisma.ApprovalRequestCreateManyInput[] = []
  const decisions: Prisma.ApprovalDecisionCreateManyInput[] = []
  const allTaskIds = new Set<string>()

  function addTask(raw: SourceTask, start = '2026-10-19', suffix = '', forceStatus?: TaskStatus) {
    const id = `${taskId(raw.title, start, raw.employee)}${suffix}`
    if (allTaskIds.has(id)) throw new Error('Duplicate fixture task identity')
    allTaskIds.add(id)
    const ownerId = personId(raw.employee)
    const seriesId = `series-${slug(raw.employee)}-${slug(raw.title)}${suffix}${start === '2026-10-19' ? '' : `-${start}`}`
    series.push({ id: seriesId, ownerId, createdAt: watMidnight(day(start)) })
    const status = forceStatus ?? statusLabels[raw.status]
    if (!status) throw new Error('Unsupported prototype status')
    const record = { id, seriesId, trackerId: trackerId(raw.employee, start), ownerId, title: raw.title,
      activity: raw.activity, startsOn: day(start === '2026-10-19' ? raw.start : start),
      endsOn: day(start === '2026-10-19' ? raw.end : isoDay(shiftDay(day(start), 4))),
      status, blockerReason: status === TaskStatus.BLOCKED ? raw.reason ?? 'Source review is still outstanding.' : null,
      carryRequested: raw.carry ?? false, createdAt: watMidnight(day(start)) }
    tasks.push(record)
    return record
  }

  function addRequest(task: Prisma.WeeklyTaskCreateManyInput & { id: string }, attempt: number, submittedAt: Date,
    state: ApprovalState, options: { originalAssignment?: string; reviewer?: string | null; snapshotActivity?: string } = {}) {
    const owner = users.find((record) => record.id === task.ownerId)!
    const originalAssignment = options.originalAssignment
      ?? assignments.find((record) => record.userId === owner.id && record.effectiveFrom <= submittedAt
        && (record.effectiveTo === null || record.effectiveTo > submittedAt))?.id
    if (!originalAssignment) throw new Error('Missing submission assignment')
    const assignment = assignments.find((record) => record.id === originalAssignment)!
    const parentTracker = trackers.find((record) => record.id === task.trackerId)!
    const parentWeek = weeks.find((record) => record.id === parentTracker.weekId)!
    const id = `request-${task.id}-${attempt}`
    requests.push({ id, weeklyTaskId: task.id, attemptNumber: attempt, submittedById: owner.id,
      submissionAssignmentId: originalAssignment, assignedManagerId: options.reviewer === undefined ? assignment.managerId : options.reviewer,
      submittedAt, state, submissionSnapshot: { version: 1, title: task.title,
        activity: options.snapshotActivity ?? task.activity, startsOn: isoDay(new Date(task.startsOn)), endsOn: isoDay(new Date(task.endsOn)),
        ownerId: owner.id, ownerDisplayName: owner.name, weekStartsOn: isoDay(parentWeek.startsOn), status: 'AWAITING_APPROVAL' } })
    return id
  }
  function addDecision(requestId: string, kind: DecisionKind, at: Date, actor = 'Tunde Bakare', reason?: string, cover?: string, automatic = false) {
    decisions.push({ id: `decision-${requestId}`, requestId, decision: kind, method: automatic ? DecisionMethod.AUTOMATIC : DecisionMethod.HUMAN,
      actorId: automatic ? null : personId(actor), actingForManagerId: cover ? personId('Nneka Obi') : null,
      reliefAssignmentId: cover ?? null, reason: reason ?? null, decidedAt: at })
  }

  for (const raw of baseTasks) {
    const task = addTask(raw)
    raw.comments.forEach((comment, index) => {
      const time = comment.time.match(/(\d{2}:\d{2})/)?.[1] ?? '10:00'
      comments.push({ id: `comment-${task.id}-${index}`, weeklyTaskId: task.id, authorId: personId(comment.author), body: comment.text,
        createdAt: instant(`2026-10-19T${time}:00+01:00`) })
    })
    if (task.status === TaskStatus.APPROVED) {
      const date = raw.approvedOn?.match(/\d+/)?.[0] ?? '20'
      const decisionAt = instant(`2026-10-${date.padStart(2, '0')}T10:00:00+01:00`)
      const request = addRequest(task, 1, new Date(decisionAt.getTime() - 3600000), ApprovalState.DECIDED)
      addDecision(request, DecisionKind.APPROVE, decisionAt)
    } else if (task.status === TaskStatus.DECLINED) {
      const request = addRequest(task, 1, instant('2026-10-19T08:00:00+01:00'), ApprovalState.DECIDED)
      addDecision(request, DecisionKind.DECLINE, instant('2026-10-19T09:00:00+01:00'), 'Tunde Bakare', raw.reason)
    } else if (task.status === TaskStatus.AWAITING_APPROVAL) {
      let attempt = 1
      if (raw.title === 'Finalise the onboarding pack') {
        const previous = addRequest(task, 1, instant('2026-10-19T08:00:00+01:00'), ApprovalState.DECIDED,
          { snapshotActivity: `Earlier draft: ${task.activity}` })
        addDecision(previous, DecisionKind.DECLINE, instant('2026-10-19T08:30:00+01:00'), 'Tunde Bakare', 'Please include the updated onboarding checklist.')
        attempt = 2
      }
      addRequest(task, attempt, instant('2026-10-19T10:00:00+01:00'), ApprovalState.PENDING)
    }
    if (raw.carry) tasks.push({ id: `${task.id}-carry`, seriesId: task.seriesId, trackerId: trackerId(raw.employee, '2026-10-26'),
      ownerId: task.ownerId, carriedFromId: task.id, title: task.title, activity: task.activity, startsOn: day('2026-10-26'),
      endsOn: day(raw.end > '2026-10-26' ? raw.end : '2026-10-30'), status: TaskStatus.PENDING, createdAt: watMidnight(day('2026-10-26')) })
  }

  for (const [index, raw] of source.seedTasks.filter((task) => task.employee === 'Ada Okafor').slice(0, 4).entries()) {
    const history = addTask(raw, '2026-10-12', '-history', index < 3 ? TaskStatus.APPROVED : TaskStatus.IN_PROGRESS)
    if (index < 3) {
      const request = addRequest(history, 1, instant('2026-10-16T10:00:00+01:00'), ApprovalState.DECIDED)
      addDecision(request, DecisionKind.APPROVE, index === 0 ? instant('2026-10-20T10:00:00+01:00') : instant('2026-10-16T13:00:00+01:00'))
    }
  }
  const managerHistory = addTask(baseTasks.at(-1)!, '2026-10-12', '-automatic', TaskStatus.APPROVED)
  const autoRequest = addRequest(managerHistory, 1, instant('2026-10-16T12:00:00+01:00'), ApprovalState.DECIDED, { reviewer: null })
  addDecision(autoRequest, DecisionKind.APPROVE, instant('2026-10-16T12:00:00+01:00'), '', undefined, undefined, true)

  const transferred = addTask({ ...source.seedTasks[10], title: 'Compile transfer review example', employee: 'Damilola James' }, '2026-10-12', '-routing', TaskStatus.AWAITING_APPROVAL)
  addRequest(transferred, 1, instant('2026-10-12T10:00:00+01:00'), ApprovalState.PENDING,
    { originalAssignment: 'assignment-damilola-before-transfer', reviewer: personId('Tunde Bakare') })
  const covered = addTask({ ...source.seedTasks[10], employee: 'Damilola James' }, '2026-10-12', '-relief', TaskStatus.APPROVED)
  const reliefRequest = addRequest(covered, 1, instant('2026-10-12T10:00:00+01:00'), ApprovalState.DECIDED,
    { originalAssignment: 'assignment-damilola-before-transfer', reviewer: personId('Nneka Obi') })
  addDecision(reliefRequest, DecisionKind.APPROVE, instant('2026-10-13T10:00:00+01:00'), 'Tunde Bakare', undefined, 'relief-nneka-history-example')

  const hr = personId('Kemi Adebayo')
  const unlocks: Prisma.PlanningUnlockCreateManyInput[] = [
    { id: 'unlock-expired', weekId: weekId('2026-10-19'), scope: UnlockScope.PERSON, userId: personId('Ada Okafor'), grantedById: hr,
      reason: 'Additional client priority', grantedAt: instant('2026-10-20T14:00:00+01:00'), expiresAt: instant('2026-10-20T16:00:00+01:00'),
      revokedAt: instant('2026-10-20T17:00:00+01:00'), revokedById: hr },
    { id: 'unlock-replacement', weekId: weekId('2026-10-19'), scope: UnlockScope.PERSON, userId: personId('Ada Okafor'), grantedById: hr,
      reason: 'Renewed client priority window', grantedAt: instant('2026-10-20T17:00:00+01:00'), expiresAt: instant('2026-10-23T18:00:00+01:00') },
    { id: 'unlock-unit', weekId: weekId('2026-10-19'), scope: UnlockScope.UNIT, unitId: 'unit-workforce-resourcing-assessment', grantedById: hr,
      reason: 'Assessment data arrived after lock', grantedAt: instant('2026-10-21T10:00:00+01:00'), expiresAt: instant('2026-10-23T18:00:00+01:00') },
  ]
  const audit: Prisma.AuditEventCreateManyInput[] = [
    { id: 'audit-seed-workforce', actorId: null, action: 'FIXTURE_RECORDED', targetType: 'WorkWeek', targetId: weekId('2026-10-19'), after: { source: 'HTML prototype', syntheticSupportExamples: true }, createdAt: instant('2026-10-19T08:00:00+01:00') },
    { id: 'audit-transfer', actorId: hr, action: 'REPORTING_ASSIGNMENT_CHANGED', targetType: 'User', targetId: personId('Damilola James'),
      before: { managerId: personId('Nneka Obi'), businessId: 'business-outsourcing' }, after: { managerId: personId('Tunde Bakare'), businessId: 'business-workforce-resourcing' }, createdAt: instant('2026-10-14T12:00:00+01:00') },
    { id: 'audit-unlock-renewal', actorId: hr, action: 'PLANNING_UNLOCK_RENEWED', targetType: 'PlanningUnlock', targetId: 'unlock-replacement',
      before: { id: 'unlock-expired' }, after: { id: 'unlock-replacement' }, createdAt: instant('2026-10-20T17:00:00+01:00') },
    { id: 'audit-grace-deactivation', actorId: hr, action: 'ACCOUNT_DEACTIVATED', targetType: 'User', targetId: personId('Grace Ekanem'),
      before: { accountStatus: 'ACTIVE' }, after: { accountStatus: 'INACTIVE' }, createdAt: instant('2026-10-26T09:00:00+01:00') },
  ]
  const notifications: (Prisma.NotificationCreateManyInput & { id: string; createdAt: Date })[] = [
    { id: 'notification-ada-approved', recipientId: personId('Ada Okafor'), kind: 'TASK_APPROVED', title: 'Task approved', body: 'Complete candidate shortlist was approved by Tunde Bakare.',
      weeklyTaskId: taskId('Complete candidate shortlist', '2026-10-19', 'Ada Okafor'), deduplicationKey: 'sample-shortlist-approved', createdAt: instant('2026-10-20T10:00:00+01:00') },
    { id: 'notification-tunde-pending', recipientId: personId('Tunde Bakare'), kind: 'APPROVAL_REQUESTED', title: 'Completion awaiting approval', body: 'Ada Okafor has submitted Finalise the onboarding pack.',
      weeklyTaskId: taskId('Finalise the onboarding pack', '2026-10-19', 'Ada Okafor'), deduplicationKey: 'sample-onboarding-submitted', createdAt: instant('2026-10-19T10:00:00+01:00'), readAt: instant('2026-10-19T11:00:00+01:00') },
    { id: 'notification-hr-leave', recipientId: hr, kind: 'LEAVE_RECORDED', title: 'Leave recorded', body: 'Femi Lawson is away until 26 Oct 2026.', leaveId: 'leave-femi',
      deduplicationKey: 'sample-femi-leave', createdAt: instant('2026-10-16T08:00:00Z') },
    { id: 'notification-nneka-cover', recipientId: personId('Nneka Obi'), kind: 'RELIEF_ASSIGNED', title: 'Relief cover assigned', body: 'Tunde Bakare will cover your approvals.',
      reliefAssignmentId: 'relief-nneka', deduplicationKey: 'sample-nneka-cover', createdAt: instant('2026-10-16T09:00:00Z') },
  ]
  const deliveries = notifications.map((notification) => ({
    id: `email-${notification.id}`, notificationId: notification.id,
    recipientEmail: users.find((user) => user.id === notification.recipientId)!.email,
    state: EmailState.SUPPRESSED, attemptCount: 0, scheduledAt: notification.createdAt,
    failureCode: 'LOCAL_FIXTURE_SUPPRESSED',
  })) satisfies Prisma.EmailDeliveryCreateManyInput[]
  const settings = { id: 'workforce-group', updatedById: hr }
  return { users, businesses, units, assignments, weeks, trackers, series, tasks, comments, requests, decisions, leaves, relief,
    unlocks, audit, notifications, deliveries, settings, corrections }
}

export type SeedPlan = ReturnType<typeof createSeedPlan>

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PrismaClient, TaskStatus } from '../../src/generated/prisma/client.ts'
import type { AuthConfig } from '../../server/auth/config.ts'
import { provision } from '../../server/auth/provision.ts'
import { isoDay, shiftDay, watCalendarDay } from '../../server/data-model/calendar.ts'
import { databaseClock } from '../../server/db.ts'
import { monday } from '../../server/employee/calendar.ts'
import { ensureWeek } from '../../server/employee/write-context.ts'
import { historicalFixtures } from './historical-fixtures.ts'

export async function managerFixtures(db: PrismaClient, config: AuthConfig, { olderPending = false } = {}) {
  const password = process.env.LOCAL_AUTH_TEST_PASSWORD
  assert.ok(password)
  const tag = randomUUID()
  const prefix = tag.slice(0, 8)
  const managerId = `f16-manager-${tag}`, otherManagerId = `f16-other-${tag}`
  const ownerId = `f16-owner-${tag}`, missingId = `f16-missing-${tag}`, leaveId = `f16-leave-${tag}`, outsideId = `f16-outside-${tag}`
  const source = await db.employmentAssignment.findFirstOrThrow({ where: { userId: 'person-tunde-bakare', effectiveTo: null }, include: { business: true, unit: true } })
  assert.ok(source.businessId && source.unitId && source.business && source.unit)
  const { businessId, unitId } = source
  const managerName = `Dashboard Manager ${prefix}`, ownerName = `Dashboard Employee ${prefix}`, missingName = `Missing Employee ${prefix}`
  const blockerTitle = `Waiting for dashboard inputs ${prefix}`
  const email = `manager-${tag}@example.invalid`
  const ownerEmail = `employee-${tag}@example.invalid`
  const fixture = await historicalFixtures(async (tx) => {
    const at = await databaseClock(tx)
    const start = monday(at)
    const effectiveFrom = new Date(start.getTime() - 3600000)
    const people = [
      { id: managerId, name: managerName, email, managerId: null },
      { id: otherManagerId, name: `Other Manager ${prefix}`, email: `other-${tag}@example.invalid`, managerId: null },
      { id: ownerId, name: ownerName, email: ownerEmail, managerId },
      { id: missingId, name: missingName, email: `missing-${tag}@example.invalid`, managerId },
      { id: leaveId, name: `On Leave ${prefix}`, email: `leave-${tag}@example.invalid`, managerId },
      { id: outsideId, name: `Outside Employee ${prefix}`, email: `outside-${tag}@example.invalid`, managerId: otherManagerId },
    ]
    const assignments = new Map<string, string>()
    for (const person of people) {
      await tx.user.create({ data: { id: person.id, name: person.name, email: person.email, accountStatus: 'ACTIVE', createdAt: effectiveFrom } })
      const assignment = await tx.employmentAssignment.create({ data: {
        userId: person.id, role: person.managerId ? 'EMPLOYEE' : 'LINE_MANAGER', businessId, unitId, managerId: person.managerId, effectiveFrom,
      } })
      assignments.set(person.id, assignment.id)
    }
    await tx.leaveRecord.create({ data: { userId: leaveId, startsOn: start, expectedReturnOn: shiftDay(start, 5), createdAt: effectiveFrom } })
    const workWeek = await ensureWeek(tx, start)
    assert.ok(workWeek.freezesAt > at, 'The isolated fixture needs an open current workweek')
    await tx.planningUnlock.create({ data: { weekId: workWeek.id, scope: 'PERSON', userId: missingId, grantedById: 'person-kemi-adebayo',
      reason: 'Isolated manager dashboard test', grantedAt: at, expiresAt: workWeek.freezesAt } })
    const trackers = new Map<string, string>()
    async function task(owner: string, title: string, status: TaskStatus, blockerReason?: string) {
      let trackerId = trackers.get(owner)
      if (!trackerId) {
        const person = people.find(({ id }) => id === owner)!
        const tracker = await tx.weeklyTracker.create({ data: {
          userId: owner, weekId: workWeek.id, assignmentId: assignments.get(owner)!,
          contextSnapshot: { version: 1, userId: owner, displayName: person.name, role: person.managerId ? 'EMPLOYEE' : 'LINE_MANAGER',
            accountStatus: 'ACTIVE', businessId, businessName: source.business!.name, unitId, unitName: source.unit!.name,
            managerId: person.managerId, managerName: person.managerId ? people.find(({ id }) => id === person.managerId)!.name : null, departmentLabel: null },
        } })
        trackerId = tracker.id
        trackers.set(owner, trackerId)
      }
      const series = await tx.taskSeries.create({ data: { ownerId: owner } })
      return tx.weeklyTask.create({ data: { ownerId: owner, trackerId, seriesId: series.id, title, activity: 'Follow up on the real dashboard fixture.',
        startsOn: start, endsOn: shiftDay(start, 4), status, blockerReason } })
    }
    const blocked = await task(ownerId, blockerTitle, 'BLOCKED', 'Waiting for the approved input from the client.')
    await task(ownerId, 'Work in progress', 'IN_PROGRESS')
    await task(ownerId, 'Work declined', 'DECLINED')
    await task(ownerId, 'Work cancelled', 'CANCELLED')
    const approved = await task(ownerId, 'Approved dashboard task', 'APPROVED')
    const submission = (task: { id: string; title: string; activity: string }) => ({
      weeklyTaskId: task.id, submittedById: ownerId, submissionAssignmentId: assignments.get(ownerId)!,
      assignedManagerId: managerId, submittedAt: at, attemptNumber: 1,
      submissionSnapshot: { version: 1, ownerId, title: task.title, ownerDisplayName: ownerName, activity: task.activity,
        startsOn: isoDay(start), endsOn: isoDay(shiftDay(start, 4)), weekStartsOn: isoDay(start), status: 'AWAITING_APPROVAL' },
    })
    const completed = await tx.approvalRequest.create({ data: { ...submission(approved), state: 'DECIDED' } })
    await tx.approvalDecision.create({ data: { requestId: completed.id, actorId: managerId, decision: 'APPROVE', method: 'HUMAN', decidedAt: at } })
    const approval = await task(ownerId, 'Work ready for review', 'AWAITING_APPROVAL')
    const request = await tx.approvalRequest.create({ data: submission(approval) })
    if (olderPending) {
      let older = shiftDay(start, -7)
      while (await tx.workWeek.findUnique({ where: { startsOn: older } })) older = shiftDay(older, -7)
      const endsOn = shiftDay(older, 4)
      const olderWeek = await tx.workWeek.create({ data: { startsOn: older,
        freezesAt: new Date(shiftDay(older, 5).getTime() - 3600000), planningLocksAt: shiftDay(older, 1) } })
      const currentTracker = await tx.weeklyTracker.findUniqueOrThrow({ where: { id: approval.trackerId } })
      const tracker = await tx.weeklyTracker.create({ data: { userId: ownerId, weekId: olderWeek.id, assignmentId: assignments.get(ownerId)!,
        contextSnapshot: currentTracker.contextSnapshot as NonNullable<typeof currentTracker.contextSnapshot> } })
      const series = await tx.taskSeries.create({ data: { ownerId } })
      const olderTask = await tx.weeklyTask.create({ data: { ownerId, trackerId: tracker.id, seriesId: series.id,
        title: 'Older pending submission', activity: approval.activity, startsOn: older, endsOn, status: 'AWAITING_APPROVAL' } })
      const snapshot = submission(olderTask)
      await tx.approvalRequest.create({ data: { ...snapshot, submittedAt: older, submissionSnapshot: {
        ...snapshot.submissionSnapshot, startsOn: isoDay(older), endsOn: isoDay(endsOn), weekStartsOn: isoDay(older),
      } } })
    }
    const outside = await task(outsideId, 'Outside dashboard task', 'BLOCKED', 'This task is private to another team.')
    await task(managerId, 'Manager private work', 'IN_PROGRESS')
    return { week: isoDay(start), weekId: workWeek.id, blockerId: blocked.id, outsideTaskId: outside.id, requestId: request.id,
      today: watCalendarDay(at), ownerAssignmentId: assignments.get(ownerId)! }
  })
  await provision(db, config, managerId, password)
  await provision(db, config, ownerId, password)
  return { ...fixture, tag, prefix, password, managerId, managerName, otherManagerId, ownerId, ownerName, missingId, missingName,
    leaveId, outsideId, blockerTitle, email, ownerEmail }
}

import type { PrismaClient } from '../../src/generated/prisma/client.ts'
import { day, isoDay, shiftDay, watMidnight } from '../../server/data-model/calendar.ts'
import { databaseClock } from '../../server/db.ts'
import { historicalFixtures } from './historical-fixtures.ts'
import type { managerFixtures } from './manager-dashboard-fixtures.ts'

export async function frozenTeamFixture(db: PrismaClient, fixture: Awaited<ReturnType<typeof managerFixtures>>, complete = true, pending = false) {
  const original = await db.employmentAssignment.findUniqueOrThrow({ where: { id: fixture.ownerAssignmentId }, include: { unit: true, business: true } })
  return historicalFixtures(async (tx) => {
    const at = await databaseClock(tx)
    const current = day(fixture.week)
    const occupied = new Set((await tx.workWeek.findMany({ where: { startsOn: { lt: current } }, select: { startsOn: true } }))
      .map(({ startsOn }) => isoDay(startsOn)))
    let start = shiftDay(current, -7)
    while (occupied.has(isoDay(start)) || occupied.has(isoDay(shiftDay(start, -7)))) start = shiftDay(start, -7)
    const previousStart = shiftDay(start, -7)
    const previousFreeze = watMidnight(shiftDay(previousStart, 5))
    const freezesAt = watMidnight(shiftDay(start, 5)), startsAt = watMidnight(start), until = watMidnight(current)
    const week = await tx.workWeek.create({ data: { startsOn: start, freezesAt, planningLocksAt: watMidnight(shiftDay(start, 1)) } })
    const assignmentData = { role: 'EMPLOYEE' as const, businessId: original.businessId, unitId: original.unitId }
    async function record(kind: string, name: string, days: number, transferred = false, inactive = false, employedFrom = startsAt) {
      const id = `f18-${kind}-${fixture.tag}`
      await tx.user.create({ data: { id, name: `Current ${name}`, email: `${id}@example.invalid`, createdAt: employedFrom,
        accountStatus: inactive ? 'INACTIVE' : 'ACTIVE', deactivatedAt: inactive ? until : null } })
      const assignment = await tx.employmentAssignment.create({ data: { ...assignmentData, userId: id, effectiveFrom: employedFrom,
        effectiveTo: transferred || inactive ? until : null, managerId: fixture.managerId } })
      if (transferred) await tx.employmentAssignment.create({ data: { ...assignmentData, userId: id, effectiveFrom: until, managerId: fixture.otherManagerId } })
      const context = { version: 1, userId: id, displayName: name, role: 'EMPLOYEE', accountStatus: 'ACTIVE',
        unitId: original.unitId, unitName: 'Recorded unit', businessId: original.businessId, businessName: 'Recorded business',
        managerId: fixture.managerId, managerName: 'Recorded line manager', departmentLabel: 'Recorded department' }
      const tracker = await tx.weeklyTracker.create({ data: { userId: id, weekId: week.id, assignmentId: assignment.id, snapshotAt: at,
        expectedWorkingDaysSnapshot: days, contextSnapshot: context } })
      return { id, name, assignment, tracker, context }
    }
    const transfer = await record('transfer', `Transferred employee ${fixture.prefix}`, 4, true)
    const empty = await record('empty', `Inactive empty employee ${fixture.prefix}`, 5, false, true)
    const cancelled = await record('cancelled', `Cancelled employee ${fixture.prefix}`, 5, false, false, watMidnight(previousStart))
    const onLeave = await record('leave', `Historical leave ${fixture.prefix}`, 0)
    const excluded = await record('excluded', `Historical excluded ${fixture.prefix}`, 0)
    await tx.leaveRecord.createMany({ data: [
      { userId: onLeave.id, startsOn: start, expectedReturnOn: shiftDay(start, 5), createdAt: startsAt },
      { userId: transfer.id, startsOn: start, expectedReturnOn: shiftDay(start, 1), createdAt: startsAt },
    ] })
    const title = `Frozen deliverable ${fixture.prefix}`, activity = 'Captured activity from the recorded week.'
    const series = await tx.taskSeries.create({ data: { ownerId: transfer.id } })
    const task = await tx.weeklyTask.create({ data: { ownerId: transfer.id, trackerId: transfer.tracker.id, seriesId: series.id,
      startsOn: start, endsOn: shiftDay(start, 4), createdAt: startsAt, status: pending ? 'AWAITING_APPROVAL' : 'APPROVED',
      title: pending ? title : 'Canonical text', activity: pending ? activity : 'Canonical activity' } })
    const request = await tx.approvalRequest.create({ data: { weeklyTaskId: task.id, submittedById: transfer.id, submissionAssignmentId: transfer.assignment.id,
      assignedManagerId: fixture.managerId, submittedAt: startsAt, state: pending ? 'PENDING' : 'DECIDED', attemptNumber: 1,
      submissionSnapshot: { version: 1, ownerId: transfer.id, title, ownerDisplayName: transfer.name, activity,
        startsOn: isoDay(start), endsOn: isoDay(task.endsOn), weekStartsOn: isoDay(start), status: 'AWAITING_APPROVAL' } } })
    if (!pending) await tx.approvalDecision.create({ data: { requestId: request.id, actorId: fixture.managerId, decision: 'APPROVE', method: 'HUMAN', decidedAt: at } })
    const cancelledSeries = await tx.taskSeries.create({ data: { ownerId: cancelled.id } })
    const cancelledTask = await tx.weeklyTask.create({ data: { ownerId: cancelled.id, trackerId: cancelled.tracker.id, seriesId: cancelledSeries.id,
      startsOn: start, endsOn: start, createdAt: startsAt, status: 'CANCELLED', title: 'Cancelled work', activity: 'Still part of this week.' } })
    const archive = await tx.historyWeekSnapshot.create({ data: { weekId: week.id, startsOn: start, freezesAt, capturedAt: at } })
    await tx.historyPersonSnapshot.createMany({ data: [transfer, empty, cancelled, onLeave, excluded].map(({ tracker }) => ({
      userId: tracker.userId, assignmentId: tracker.assignmentId, historyWeekId: archive.id, contextSnapshot: tracker.contextSnapshot!,
      expectedWorkingDaysSnapshot: tracker.expectedWorkingDaysSnapshot!, snapshotAt: at,
    })) })
    await tx.historyTaskSnapshot.createMany({ data: [
      { id: task.id, ownerId: transfer.id, ownerName: transfer.name, historyWeekId: archive.id, startsOn: start, endsOn: task.endsOn,
        createdAt: startsAt, status: 'AWAITING_APPROVAL', title, activity, revision: 0, carryRequested: false, carriedFrom: false },
      { id: cancelledTask.id, ownerId: cancelled.id, ownerName: cancelled.name, historyWeekId: archive.id, startsOn: start, endsOn: start,
        createdAt: startsAt, status: 'CANCELLED', title: cancelledTask.title, activity: cancelledTask.activity, revision: 0, carryRequested: false, carriedFrom: false },
    ] })
    await tx.historyReviewSnapshot.create({ data: { id: request.id, taskSnapshotId: task.id, attemptNumber: 1, state: 'PENDING', submittedAt: startsAt } })
    const comment = 'This is the captured conversation.'
    await tx.historyCommentSnapshot.create({ data: { id: `f18-comment-${fixture.tag}`, taskSnapshotId: task.id, createdAt: startsAt, body: comment, authorName: 'Recorded line manager' } })
    if (complete) await tx.workWeek.update({ where: { id: week.id }, data: { rosterCapturedAt: at } })

    const previous = await tx.workWeek.create({ data: { startsOn: previousStart, freezesAt: previousFreeze, rosterCapturedAt: at,
      planningLocksAt: watMidnight(shiftDay(previousStart, 1)) } })
    const previousArchive = await tx.historyWeekSnapshot.create({ data: { weekId: previous.id, startsOn: previousStart, freezesAt: previousFreeze, capturedAt: at } })
    const previousContext = { ...cancelled.context, unitName: 'Previous unit' }
    await tx.weeklyTracker.create({ data: { userId: cancelled.id, assignmentId: cancelled.assignment.id, weekId: previous.id,
      snapshotAt: at, expectedWorkingDaysSnapshot: 5, contextSnapshot: previousContext } })
    await tx.historyPersonSnapshot.create({ data: { userId: cancelled.id, assignmentId: cancelled.assignment.id, historyWeekId: previousArchive.id,
      snapshotAt: at, expectedWorkingDaysSnapshot: 5, contextSnapshot: previousContext } })
    return { week: isoDay(start), previousWeek: isoDay(previousStart), weekId: week.id, transfer, empty, cancelled, onLeave, excluded, taskId: task.id,
      requestId: request.id, title, activity, comment }
  })
}

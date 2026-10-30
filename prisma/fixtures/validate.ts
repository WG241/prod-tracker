import assert from 'node:assert/strict'
import { isoDay, watMidnight } from '../../server/data-model/calendar.ts'
import type { SeedPlan } from './plan.ts'

function index<T extends { id?: string }>(rows: readonly T[]) {
  const result = new Map<string, T>()
  for (const row of rows) {
    assert.ok(row.id, 'Fixture identity is required')
    assert.ok(!result.has(row.id), 'Fixture identities must be unique')
    result.set(row.id, row)
  }
  return result
}
const date = (value: Date | string) => new Date(value)
const endDate = (value: Date | string | null | undefined) => value ? date(value) : null

export function validateSeedPlan(plan: SeedPlan) {
  const users = index(plan.users)
  const units = index(plan.units)
  const assignments = index(plan.assignments)
  const trackers = index(plan.trackers)
  const weeks = index(plan.weeks)
  const tasks = index(plan.tasks)
  const series = index(plan.series)
  const leaves = index(plan.leaves)
  const cover = index(plan.relief)
  const requests = index(plan.requests)
  assert.equal(new Set(plan.users.map((user) => user.email)).size, plan.users.length)
  const at = (userId: string, instant: Date) => plan.assignments.find((row) => row.userId === userId
    && row.effectiveFrom <= instant && (row.effectiveTo === null || row.effectiveTo > instant))

  for (const person of plan.users) {
    assert.equal(plan.assignments.filter((row) => row.userId === person.id && row.effectiveTo === null).length, 1)
    assert.equal(person.email, person.email.trim().toLowerCase())
    const periods = plan.assignments.filter((row) => row.userId === person.id).toSorted((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
    for (let i = 1; i < periods.length; i++) {
      assert.ok(periods[i - 1].effectiveTo !== null && periods[i - 1].effectiveTo! <= periods[i].effectiveFrom, 'Assignment intervals overlap')
    }
  }
  for (const assignment of plan.assignments) {
    assert.ok(users.has(assignment.userId))
    if (assignment.unitId) assert.equal(units.get(assignment.unitId)?.businessId, assignment.businessId)
    if (assignment.role === 'EMPLOYEE') {
      assert.ok(assignment.managerId)
      const manager = at(assignment.managerId, assignment.effectiveFrom)
      assert.equal(manager?.role, 'LINE_MANAGER')
      assert.equal(manager?.businessId, assignment.businessId)
      assert.notEqual(assignment.userId, assignment.managerId)
    }
  }
  for (const tracker of plan.trackers) {
    assert.equal(assignments.get(tracker.assignmentId)?.userId, tracker.userId)
    assert.ok(weeks.has(tracker.weekId))
    assert.ok(users.has(tracker.userId))
  }
  for (const task of plan.tasks) {
    assert.equal(trackers.get(task.trackerId)?.userId, task.ownerId)
    assert.equal(series.get(task.seriesId)?.ownerId, task.ownerId)
    if (task.carriedFromId) {
      const parent = tasks.get(task.carriedFromId)
      assert.ok(parent)
      assert.equal(parent.seriesId, task.seriesId)
      const previousWeek = weeks.get(trackers.get(parent.trackerId)!.weekId)!
      const currentWeek = weeks.get(trackers.get(task.trackerId)!.weekId)!
      assert.ok(currentWeek.startsOn > previousWeek.startsOn)
    }
    const attempts = plan.requests.filter((row) => row.weeklyTaskId === task.id).toSorted((a, b) => b.attemptNumber - a.attemptNumber)
    const latest = attempts[0]
    const decision = latest ? plan.decisions.find((row) => row.requestId === latest.id) : undefined
    if (task.status === 'AWAITING_APPROVAL') assert.equal(latest?.state, 'PENDING')
    if (task.status === 'APPROVED') assert.equal(decision?.decision, 'APPROVE')
    if (task.status === 'DECLINED') assert.equal(decision?.decision, 'DECLINE')
  }
  for (const request of plan.requests) {
    assert.equal(tasks.get(request.weeklyTaskId)?.ownerId, request.submittedById)
    const assignment = assignments.get(request.submissionAssignmentId)
    assert.equal(assignment?.userId, request.submittedById)
    assert.ok(assignment!.effectiveFrom <= date(request.submittedAt!))
    assert.ok(assignment!.effectiveTo === null || assignment!.effectiveTo > date(request.submittedAt!))
    const decisions = plan.decisions.filter((row) => row.requestId === request.id)
    assert.equal(decisions.length, request.state === 'DECIDED' ? 1 : 0)
    if (request.state === 'PENDING') {
      assert.equal(request.assignedManagerId, plan.assignments.find((row) => row.userId === request.submittedById && row.effectiveTo === null)?.managerId)
    }
  }
  for (const decision of plan.decisions) {
    const request = requests.get(decision.requestId)!
    if (decision.method === 'AUTOMATIC') {
      assert.equal(at(request.submittedById, date(request.submittedAt!))?.role, 'LINE_MANAGER')
      assert.equal(decision.actorId, null)
    } else {
      assert.ok(decision.actorId && users.has(decision.actorId))
      assert.equal(at(decision.actorId!, date(decision.decidedAt!))?.role, 'LINE_MANAGER')
      if (decision.reliefAssignmentId) {
        const assignment = cover.get(decision.reliefAssignmentId)!
        assert.equal(assignment.reliefManagerId, decision.actorId)
        assert.equal(assignment.coveredManagerId, request.assignedManagerId)
        assert.ok(date(decision.decidedAt!) >= watMidnight(date(assignment.startsOn)))
        assert.ok(date(decision.decidedAt!) < watMidnight(date(assignment.endsOn)))
      } else assert.equal(decision.actorId, request.assignedManagerId)
    }
  }
  for (const comment of plan.comments) assert.ok(users.has(comment.authorId) && tasks.has(comment.weeklyTaskId))
  for (const assignment of plan.relief) {
    const leave = leaves.get(assignment.leaveId)!
    assert.equal(leave.userId, assignment.coveredManagerId)
    assert.equal(at(assignment.reliefManagerId, watMidnight(date(assignment.startsOn)))?.role, 'LINE_MANAGER')
    assert.equal(at(assignment.coveredManagerId, watMidnight(date(assignment.startsOn)))?.role, 'LINE_MANAGER')
    assert.ok(date(assignment.startsOn) >= date(leave.startsOn))
    assert.ok(date(assignment.endsOn) <= date(leave.expectedReturnOn))
    assert.notEqual(assignment.coveredManagerId, assignment.reliefManagerId)
    const unavailable = plan.leaves.some((row) => row.userId === assignment.reliefManagerId && !row.cancelledAt
      && date(row.startsOn) < date(assignment.endsOn) && date(row.actualReturnOn ?? row.expectedReturnOn) > date(assignment.startsOn))
    assert.ok(!unavailable, 'Relief officer is on leave')
    for (const other of plan.relief) {
      if (other.id === assignment.id || other.coveredManagerId !== assignment.coveredManagerId) continue
      const aEnd = endDate(assignment.endedAt) ?? watMidnight(date(assignment.endsOn))
      const bEnd = endDate(other.endedAt) ?? watMidnight(date(other.endsOn))
      assert.ok(aEnd <= watMidnight(date(other.startsOn)) || bEnd <= watMidnight(date(assignment.startsOn)), 'Relief intervals overlap')
    }
  }
  for (const unlock of plan.unlocks) {
    assert.ok(date(unlock.expiresAt) <= weeks.get(unlock.weekId)!.freezesAt)
    assert.equal(at(unlock.grantedById, date(unlock.grantedAt!))?.role, 'HR_ADMIN')
  }
  for (const delivery of plan.deliveries) assert.equal(delivery.state, 'SUPPRESSED')
  for (const week of plan.weeks) {
    const considered = plan.users.filter((user) => plan.assignments.some((row) => row.userId === user.id
      && row.effectiveFrom < week.freezesAt && (row.effectiveTo === null || row.effectiveTo > watMidnight(week.startsOn))))
    assert.equal(plan.trackers.filter((row) => row.weekId === week.id).length, considered.length, `Incomplete roster for ${isoDay(week.startsOn)}`)
  }
}

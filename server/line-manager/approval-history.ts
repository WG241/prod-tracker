import { Prisma } from '../../src/generated/prisma/client.ts'
import type { DecisionKind } from '../../src/generated/prisma/client.ts'
import { pageOffset } from '../employee/reads.ts'
import { taskTextLimits } from '../employee/task-validation.ts'
import { submittedOwnerNameLimit } from './review-scope.ts'
import type { Tx } from './scope.ts'

// PostgreSQL JSONB already rejects NULs and unpaired surrogates. Match JavaScript
// trim and string length so malformed evidence is excluded before counting and paging.
const whitespace = '\u0009\u000A\u000B\u000C\u000D\u0020\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF'
const basicMultilingualPlane = '[^\u{10000}-\u{10FFFF}]+'

function validText(json: Prisma.Sql, key: string, max: number, length: 'trimmed' | 'raw' | 'codePoints') {
  const value = Prisma.sql`(${json}->>${key}::text)`
  const trimmed = Prisma.sql`btrim(${value}, ${whitespace})`
  const measured = length === 'trimmed' ? trimmed : value
  const units = length === 'codePoints' ? Prisma.sql`length(${measured})`
    : Prisma.sql`length(${measured}) + length(regexp_replace(${measured} COLLATE "C", ${basicMultilingualPlane}, '', 'g'))`
  return Prisma.sql`jsonb_typeof(${json}->${key}::text) = 'string' AND ${trimmed} <> '' AND ${units} <= ${max}`
}

function validDay(value: Prisma.Sql) {
  return Prisma.sql`CASE
    WHEN ${value} COLLATE "C" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' AND left(${value}, 4) <> '0000'
    THEN right(${value}, 2)::integer <= extract(day FROM (left(${value}, 7) || '-01')::date + interval '1 month - 1 day')
    ELSE FALSE
  END`
}

export function validSubmission(snapshot: Prisma.Sql, owner: Prisma.Sql, week: Prisma.Sql) {
  const start = Prisma.sql`(${snapshot}->>'startsOn')`
  const end = Prisma.sql`(${snapshot}->>'endsOn')`
  return Prisma.sql`
    ${snapshot}->'version' = '1'::jsonb AND ${snapshot}->'ownerId' = to_jsonb(${owner})
    AND ${snapshot}->>'status' = 'AWAITING_APPROVAL' AND ${snapshot}->>'weekStartsOn' = to_char(${week}, 'YYYY-MM-DD')
    AND ${validText(snapshot, 'title', taskTextLimits.title, 'trimmed')}
    AND ${validText(snapshot, 'activity', taskTextLimits.activity, 'trimmed')}
    AND ${validText(snapshot, 'ownerDisplayName', submittedOwnerNameLimit, 'codePoints')}
    AND ${validDay(start)} AND ${validDay(end)} AND ${start} <= ${end}
  `
}

export function decisionScope({
  managerId, at, current, included, personId, currentMembers,
}: {
  managerId: string; at: Date; current: Date; included: Set<string> | null; personId: string | null
  currentMembers: Iterable<{ id: string; unitName: string }>
}) {
  const snapshot = Prisma.sql`r."submissionSnapshot"`
  const context = Prisma.sql`tracker."contextSnapshot"`
  const unitByOwner = JSON.stringify(Object.fromEntries(Array.from(currentMembers, ({ id, unitName }) => [id, unitName])))
  const requiredLabels = ['displayName', 'businessId', 'businessName', 'unitId', 'unitName', 'managerId', 'managerName']
    .map((key) => validText(context, key, 10000, 'raw'))
  const selectedWeeks = included === null ? Prisma.empty : included.size === 0 ? Prisma.sql`AND FALSE`
    : Prisma.sql`AND w."startsOn" IN (${Prisma.join([...included].map((day) => Prisma.sql`${day}::date`))})`

  // The live roster supplies current authority. Frozen membership uses the
  // recorded tracker context, with the same checks as the historical roster.
  return Prisma.sql`
    FROM "ApprovalDecision" d
    JOIN "ApprovalRequest" r ON r.id = d."requestId"
    JOIN "WeeklyTask" t ON t.id = r."weeklyTaskId"
    JOIN "WeeklyTracker" tracker ON tracker.id = t."trackerId"
    JOIN "WorkWeek" w ON w.id = tracker."weekId"
    CROSS JOIN LATERAL (
      SELECT CASE WHEN w."freezesAt" > ${at}
        THEN ${unitByOwner}::jsonb->>tracker."userId"
        ELSE ${context}->>'unitName'
      END AS unit
    ) member
    WHERE d.method = 'HUMAN' AND d."decidedAt" <= ${at} AND r.state = 'DECIDED'
      AND w."startsOn" <= ${current}::date ${selectedWeeks}
      ${personId === null ? Prisma.empty : Prisma.sql`AND r."submittedById" = ${personId}`}
      AND (
        (w."startsOn" = ${current}::date AND w."freezesAt" > ${at} AND member.unit IS NOT NULL)
        OR (w."freezesAt" <= ${at}
          AND tracker."snapshotAt" >= w."freezesAt" AND tracker."expectedWorkingDaysSnapshot" BETWEEN 0 AND 5
          AND ${context}->'version' = '1'::jsonb AND ${context}->'userId' = to_jsonb(tracker."userId")
          AND ${context}->>'role' = 'EMPLOYEE' AND ${context}->>'accountStatus' = 'ACTIVE'
          AND ${context}->>'managerId' = ${managerId}
          AND ${Prisma.join(requiredLabels, ' AND ')}
          AND (${context}->'departmentLabel' = 'null'::jsonb OR (${validText(context, 'departmentLabel', 10000, 'raw')})))
      )
      AND ${validSubmission(snapshot, Prisma.sql`r."submittedById"`, Prisma.sql`w."startsOn"`)}
  `
}

export async function decisionCounts(tx: Tx, scope: Prisma.Sql) {
  const [counts] = await tx.$queryRaw<{ approved: bigint; declined: bigint }[]>`
    SELECT count(*) FILTER (WHERE d.decision = 'APPROVE') AS approved,
           count(*) FILTER (WHERE d.decision = 'DECLINE') AS declined
    ${scope}
  `
  return { APPROVED: Number(counts.approved), DECLINED: Number(counts.declined) }
}

export async function decisionPage(tx: Tx, scope: Prisma.Sql, kind: DecisionKind, page: number, total: number) {
  const skip = pageOffset(page, total)
  if (skip === null || !total) return []
  return tx.$queryRaw<{ requestId: string; unit: string }[]>`
    SELECT r.id AS "requestId", member.unit ${scope}
      AND d.decision = ${kind}::"DecisionKind"
    ORDER BY d."decidedAt" DESC, d.id DESC
    LIMIT 25 OFFSET ${skip}
  `
}

export async function decisionWeeks(tx: Tx, scope: Prisma.Sql, kind: DecisionKind) {
  const rows = await tx.$queryRaw<{ week: string }[]>`
    SELECT DISTINCT to_char(w."startsOn", 'YYYY-MM-DD') AS week ${scope}
      AND d.decision = ${kind}::"DecisionKind" ORDER BY week DESC
  `
  return rows.map(({ week }) => week)
}

export async function decisionPeople(tx: Tx, scope: Prisma.Sql, kind: DecisionKind) {
  return tx.$queryRaw<{ id: string; label: string; unit: string }[]>`
    SELECT id, label, unit FROM (
      SELECT DISTINCT ON (1, 2, 3) r."submittedById" AS id, r."submissionSnapshot"->>'ownerDisplayName' AS label,
        member.unit, d."decidedAt", d.id AS "decisionId" ${scope}
        AND d.decision = ${kind}::"DecisionKind"
      ORDER BY 1, 2, 3, d."decidedAt" DESC, d.id DESC
    ) options
    ORDER BY "decidedAt" DESC, "decisionId" DESC
  `
}

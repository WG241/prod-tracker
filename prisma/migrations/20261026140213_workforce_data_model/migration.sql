-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'LINE_MANAGER', 'BUSINESS_DIRECTOR', 'EXECUTIVE', 'HR_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'BLOCKED', 'AWAITING_APPROVAL', 'APPROVED', 'DECLINED', 'ON_HOLD', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ApprovalState" AS ENUM ('PENDING', 'DECIDED', 'WITHDRAWN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DecisionKind" AS ENUM ('APPROVE', 'DECLINE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "DecisionMethod" AS ENUM ('HUMAN', 'AUTOMATIC');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "UnlockScope" AS ENUM ('PERSON', 'UNIT', 'BUSINESS', 'EVERYONE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EmailState" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "accountStatus" "AccountStatus" NOT NULL DEFAULT 'INACTIVE';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "deactivatedAt" TIMESTAMPTZ(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "emailRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3) USING "createdAt" AT TIME ZONE 'UTC';
ALTER TABLE "User" ALTER COLUMN "updatedAt" SET DATA TYPE TIMESTAMPTZ(3) USING "updatedAt" AT TIME ZONE 'UTC';

-- CreateTable
CREATE TABLE IF NOT EXISTS "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Unit" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmploymentAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "businessId" TEXT,
    "unitId" TEXT,
    "managerId" TEXT,
    "departmentLabel" TEXT,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmploymentAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkWeek" (
    "id" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "planningLocksAt" TIMESTAMPTZ(3) NOT NULL,
    "freezesAt" TIMESTAMPTZ(3) NOT NULL,
    "manuallyLockedAt" TIMESTAMPTZ(3),
    "lockedById" TEXT,
    "lockReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkWeek_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WeeklyTracker" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "contextSnapshot" JSONB NOT NULL,
    "expectedWorkingDaysSnapshot" INTEGER,
    "snapshotAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WeeklyTracker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskSeries" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WeeklyTask" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "trackerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "carriedFromId" TEXT,
    "title" VARCHAR(120) NOT NULL,
    "activity" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "blockerReason" TEXT,
    "carryRequested" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WeeklyTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TaskComment" (
    "id" TEXT NOT NULL,
    "weeklyTaskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "weeklyTaskId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "submittedById" TEXT NOT NULL,
    "submissionAssignmentId" TEXT NOT NULL,
    "submissionSnapshot" JSONB NOT NULL,
    "assignedManagerId" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "ApprovalState" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ApprovalDecision" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "decision" "DecisionKind" NOT NULL,
    "method" "DecisionMethod" NOT NULL,
    "actorId" TEXT,
    "actingForManagerId" TEXT,
    "reliefAssignmentId" TEXT,
    "reason" TEXT,
    "decidedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeaveRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "expectedReturnOn" DATE NOT NULL,
    "actualReturnOn" DATE,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReliefAssignment" (
    "id" TEXT NOT NULL,
    "leaveId" TEXT NOT NULL,
    "coveredManagerId" TEXT NOT NULL,
    "reliefManagerId" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "endedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReliefAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TrackerSettings" (
    "id" TEXT NOT NULL DEFAULT 'workforce-group',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Lagos',
    "openingDay" "Weekday" NOT NULL DEFAULT 'MONDAY',
    "openingTime" TEXT NOT NULL DEFAULT '08:00',
    "followupDay" "Weekday" NOT NULL DEFAULT 'TUESDAY',
    "followupTime" TEXT NOT NULL DEFAULT '12:00',
    "updateDay" "Weekday" NOT NULL DEFAULT 'FRIDAY',
    "updateTime" TEXT NOT NULL DEFAULT '15:00',
    "lockDay" "Weekday" NOT NULL DEFAULT 'TUESDAY',
    "lockTime" TEXT NOT NULL DEFAULT '14:00',
    "overdueApprovalDays" INTEGER NOT NULL DEFAULT 3,
    "monthEndDay" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrackerSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PlanningUnlock" (
    "id" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "scope" "UnlockScope" NOT NULL,
    "userId" TEXT,
    "unitId" TEXT,
    "businessId" TEXT,
    "grantedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" TEXT,

    CONSTRAINT "PlanningUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "weeklyTaskId" TEXT,
    "leaveId" TEXT,
    "reliefAssignmentId" TEXT,
    "deduplicationKey" TEXT NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "EmailDelivery" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "recipientEmail" TEXT NOT NULL,
    "state" "EmailState" NOT NULL DEFAULT 'QUEUED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Business_name_key" ON "Business"("name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Unit_businessId_name_key" ON "Unit"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Unit_id_businessId_key" ON "Unit"("id", "businessId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmploymentAssignment_userId_effectiveFrom_idx" ON "EmploymentAssignment"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmploymentAssignment_businessId_role_idx" ON "EmploymentAssignment"("businessId", "role");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmploymentAssignment_managerId_effectiveTo_idx" ON "EmploymentAssignment"("managerId", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmploymentAssignment_id_userId_key" ON "EmploymentAssignment"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkWeek_startsOn_key" ON "WorkWeek"("startsOn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTracker_weekId_assignmentId_idx" ON "WeeklyTracker"("weekId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTracker_userId_weekId_key" ON "WeeklyTracker"("userId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTracker_id_userId_key" ON "WeeklyTracker"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TaskSeries_id_ownerId_key" ON "TaskSeries"("id", "ownerId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTask_trackerId_status_idx" ON "WeeklyTask"("trackerId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WeeklyTask_ownerId_deletedAt_idx" ON "WeeklyTask"("ownerId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTask_seriesId_trackerId_key" ON "WeeklyTask"("seriesId", "trackerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTask_id_ownerId_key" ON "WeeklyTask"("id", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WeeklyTask_id_seriesId_key" ON "WeeklyTask"("id", "seriesId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TaskComment_weeklyTaskId_createdAt_idx" ON "TaskComment"("weeklyTaskId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalRequest_assignedManagerId_state_submittedAt_idx" ON "ApprovalRequest"("assignedManagerId", "state", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalRequest_weeklyTaskId_attemptNumber_key" ON "ApprovalRequest"("weeklyTaskId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ApprovalDecision_requestId_key" ON "ApprovalDecision"("requestId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ApprovalDecision_decidedAt_idx" ON "ApprovalDecision"("decidedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeaveRecord_userId_startsOn_expectedReturnOn_idx" ON "LeaveRecord"("userId", "startsOn", "expectedReturnOn");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveRecord_id_userId_key" ON "LeaveRecord"("id", "userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliefAssignment_coveredManagerId_startsOn_endsOn_idx" ON "ReliefAssignment"("coveredManagerId", "startsOn", "endsOn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReliefAssignment_reliefManagerId_startsOn_endsOn_idx" ON "ReliefAssignment"("reliefManagerId", "startsOn", "endsOn");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PlanningUnlock_weekId_expiresAt_idx" ON "PlanningUnlock"("weekId", "expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_recipientId_deduplicationKey_key" ON "Notification"("recipientId", "deduplicationKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "EmailDelivery_notificationId_key" ON "EmailDelivery"("notificationId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "EmailDelivery_state_scheduledAt_idx" ON "EmailDelivery"("state", "scheduledAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Unit" ADD CONSTRAINT "Unit_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "EmploymentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "EmploymentAssignment_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "EmploymentAssignment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "EmploymentAssignment_unitId_businessId_fkey" FOREIGN KEY ("unitId", "businessId") REFERENCES "Unit"("id", "businessId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WorkWeek" ADD CONSTRAINT "WorkWeek_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTracker" ADD CONSTRAINT "WeeklyTracker_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTracker" ADD CONSTRAINT "WeeklyTracker_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "WorkWeek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTracker" ADD CONSTRAINT "WeeklyTracker_assignmentId_userId_fkey" FOREIGN KEY ("assignmentId", "userId") REFERENCES "EmploymentAssignment"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TaskSeries" ADD CONSTRAINT "TaskSeries_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "WeeklyTask_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "WeeklyTask_seriesId_ownerId_fkey" FOREIGN KEY ("seriesId", "ownerId") REFERENCES "TaskSeries"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "WeeklyTask_trackerId_ownerId_fkey" FOREIGN KEY ("trackerId", "ownerId") REFERENCES "WeeklyTracker"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "WeeklyTask_carriedFromId_seriesId_fkey" FOREIGN KEY ("carriedFromId", "seriesId") REFERENCES "WeeklyTask"("id", "seriesId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_weeklyTaskId_fkey" FOREIGN KEY ("weeklyTaskId") REFERENCES "WeeklyTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TaskComment" ADD CONSTRAINT "TaskComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_weeklyTaskId_submittedById_fkey" FOREIGN KEY ("weeklyTaskId", "submittedById") REFERENCES "WeeklyTask"("id", "ownerId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_submissionAssignmentId_submittedById_fkey" FOREIGN KEY ("submissionAssignmentId", "submittedById") REFERENCES "EmploymentAssignment"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_assignedManagerId_fkey" FOREIGN KEY ("assignedManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ApprovalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_actingForManagerId_fkey" FOREIGN KEY ("actingForManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "ApprovalDecision_reliefAssignmentId_fkey" FOREIGN KEY ("reliefAssignmentId") REFERENCES "ReliefAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "LeaveRecord" ADD CONSTRAINT "LeaveRecord_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReliefAssignment" ADD CONSTRAINT "ReliefAssignment_leaveId_coveredManagerId_fkey" FOREIGN KEY ("leaveId", "coveredManagerId") REFERENCES "LeaveRecord"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReliefAssignment" ADD CONSTRAINT "ReliefAssignment_coveredManagerId_fkey" FOREIGN KEY ("coveredManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReliefAssignment" ADD CONSTRAINT "ReliefAssignment_reliefManagerId_fkey" FOREIGN KEY ("reliefManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "ReliefAssignment" ADD CONSTRAINT "ReliefAssignment_endedById_fkey" FOREIGN KEY ("endedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TrackerSettings" ADD CONSTRAINT "TrackerSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "PlanningUnlock_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "WorkWeek"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "PlanningUnlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "PlanningUnlock_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "PlanningUnlock_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "PlanningUnlock_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "PlanningUnlock_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_weeklyTaskId_fkey" FOREIGN KEY ("weeklyTaskId") REFERENCES "WeeklyTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_leaveId_fkey" FOREIGN KEY ("leaveId") REFERENCES "LeaveRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_reliefAssignmentId_fkey" FOREIGN KEY ("reliefAssignmentId") REFERENCES "ReliefAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Spec 0002 guarantees outside Prisma's stable schema syntax.
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "user_canonical_email" CHECK ("email" = lower(btrim("email")) AND position('@' IN "email") > 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "active_user_name" CHECK ("accountStatus" <> 'ACTIVE' OR length(btrim(coalesce("name", ''))) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Business" ADD CONSTRAINT "business_name_present" CHECK (length(btrim("name")) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Unit" ADD CONSTRAINT "unit_name_present" CHECK (length(btrim("name")) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "assignment_interval" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "assignment_not_self_managed" CHECK ("managerId" IS NULL OR "managerId" <> "userId");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmploymentAssignment" ADD CONSTRAINT "assignment_role_shape" CHECK (
    ("role" = 'EMPLOYEE' AND "businessId" IS NOT NULL AND "unitId" IS NOT NULL AND "managerId" IS NOT NULL) OR
    ("role" = 'LINE_MANAGER' AND "businessId" IS NOT NULL AND "unitId" IS NOT NULL AND "managerId" IS NULL) OR
    ("role" = 'BUSINESS_DIRECTOR' AND "businessId" IS NOT NULL AND "unitId" IS NULL AND "managerId" IS NULL) OR
    ("role" IN ('EXECUTIVE', 'HR_ADMIN') AND "businessId" IS NULL AND "unitId" IS NULL AND "managerId" IS NULL)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "one_current_assignment" ON "EmploymentAssignment" ("userId") WHERE "effectiveTo" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "one_current_business_director" ON "EmploymentAssignment" ("businessId")
  WHERE "effectiveTo" IS NULL AND "role" = 'BUSINESS_DIRECTOR';

DO $$ BEGIN
  ALTER TABLE "WorkWeek" ADD CONSTRAINT "week_starts_monday" CHECK (extract(isodow FROM "startsOn") = 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WorkWeek" ADD CONSTRAINT "week_cutoff_order" CHECK ("planningLocksAt" < "freezesAt" AND "freezesAt" > "startsOn"::timestamp AT TIME ZONE 'Africa/Lagos');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WeeklyTracker" ADD CONSTRAINT "tracker_context_shape" CHECK (
    jsonb_typeof("contextSnapshot") = 'object' AND coalesce("contextSnapshot"->>'version' = '1', false) AND
    "contextSnapshot" ?& ARRAY['userId','displayName','role','accountStatus','businessId','businessName','unitId','unitName','managerId','managerName','departmentLabel'] AND
    "contextSnapshot"->>'userId' = "userId"
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WeeklyTracker" ADD CONSTRAINT "tracker_snapshot_pair" CHECK (
    ("snapshotAt" IS NULL AND "expectedWorkingDaysSnapshot" IS NULL) OR
    ("snapshotAt" IS NOT NULL AND "expectedWorkingDaysSnapshot" IS NOT NULL AND "expectedWorkingDaysSnapshot" BETWEEN 0 AND 5)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "task_dates" CHECK ("endsOn" >= "startsOn");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "task_content" CHECK (length(btrim("title")) > 0 AND length(btrim("activity")) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "task_not_own_predecessor" CHECK ("carriedFromId" IS NULL OR "carriedFromId" <> "id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "WeeklyTask" ADD CONSTRAINT "blocked_task_reason" CHECK ("status" <> 'BLOCKED' OR length(btrim(coalesce("blockerReason", ''))) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TaskComment" ADD CONSTRAINT "comment_body_present" CHECK (length(btrim("body")) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "approval_positive_attempt" CHECK ("attemptNumber" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "pending_request_reviewer" CHECK ("state" <> 'PENDING' OR "assignedManagerId" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "submission_snapshot_shape" CHECK (
    jsonb_typeof("submissionSnapshot") = 'object' AND coalesce("submissionSnapshot"->>'version' = '1', false) AND
    "submissionSnapshot" ?& ARRAY['title','activity','startsOn','endsOn','ownerId','ownerDisplayName','weekStartsOn','status'] AND
    "submissionSnapshot"->>'ownerId' = "submittedById"
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "one_pending_approval" ON "ApprovalRequest" ("weeklyTaskId") WHERE "state" = 'PENDING';

DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "decision_actor_shape" CHECK (
    ("method" = 'HUMAN' AND "actorId" IS NOT NULL) OR
    ("method" = 'AUTOMATIC' AND "actorId" IS NULL AND "actingForManagerId" IS NULL AND "reliefAssignmentId" IS NULL AND "decision" = 'APPROVE')
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "decline_reason_present" CHECK ("decision" <> 'DECLINE' OR length(btrim(coalesce("reason", ''))) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ApprovalDecision" ADD CONSTRAINT "relief_decision_principal" CHECK ("reliefAssignmentId" IS NULL OR ("method" = 'HUMAN' AND "actingForManagerId" IS NOT NULL));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "LeaveRecord" ADD CONSTRAINT "leave_dates" CHECK ("expectedReturnOn" > "startsOn" AND ("actualReturnOn" IS NULL OR "actualReturnOn" >= "startsOn"));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ReliefAssignment" ADD CONSTRAINT "relief_dates" CHECK ("endsOn" > "startsOn");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ReliefAssignment" ADD CONSTRAINT "relief_not_self" CHECK ("coveredManagerId" <> "reliefManagerId");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "TrackerSettings" ADD CONSTRAINT "single_group_settings" CHECK ("id" = 'workforce-group' AND "timezone" = 'Africa/Lagos');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TrackerSettings" ADD CONSTRAINT "settings_ranges" CHECK ("overdueApprovalDays" > 0 AND "monthEndDay" BETWEEN 1 AND 28);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "TrackerSettings" ADD CONSTRAINT "settings_times" CHECK (
    "openingTime" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND
    "followupTime" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND
    "updateTime" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$' AND
    "lockTime" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "unlock_target_shape" CHECK (
    ("scope" = 'PERSON' AND "userId" IS NOT NULL AND "unitId" IS NULL AND "businessId" IS NULL) OR
    ("scope" = 'UNIT' AND "userId" IS NULL AND "unitId" IS NOT NULL AND "businessId" IS NULL) OR
    ("scope" = 'BUSINESS' AND "userId" IS NULL AND "unitId" IS NULL AND "businessId" IS NOT NULL) OR
    ("scope" = 'EVERYONE' AND "userId" IS NULL AND "unitId" IS NULL AND "businessId" IS NULL)
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "unlock_reason_present" CHECK (length(btrim("reason")) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "PlanningUnlock" ADD CONSTRAINT "unlock_times" CHECK ("expiresAt" > "grantedAt" AND ("revokedAt" IS NULL OR "revokedAt" >= "grantedAt"));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "one_person_unlock" ON "PlanningUnlock" ("weekId", "userId") WHERE "revokedAt" IS NULL AND "scope" = 'PERSON';
CREATE UNIQUE INDEX IF NOT EXISTS "one_unit_unlock" ON "PlanningUnlock" ("weekId", "unitId") WHERE "revokedAt" IS NULL AND "scope" = 'UNIT';
CREATE UNIQUE INDEX IF NOT EXISTS "one_business_unlock" ON "PlanningUnlock" ("weekId", "businessId") WHERE "revokedAt" IS NULL AND "scope" = 'BUSINESS';
CREATE UNIQUE INDEX IF NOT EXISTS "one_everyone_unlock" ON "PlanningUnlock" ("weekId") WHERE "revokedAt" IS NULL AND "scope" = 'EVERYONE';

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "notification_content" CHECK (length(btrim("kind")) > 0 AND length(btrim("title")) > 0 AND length(btrim("body")) > 0 AND length(btrim("deduplicationKey")) > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "notification_read_time" CHECK ("readAt" IS NULL OR "readAt" >= "createdAt");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmailDelivery" ADD CONSTRAINT "delivery_attempts" CHECK ("attemptCount" >= 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmailDelivery" ADD CONSTRAINT "sent_delivery_timestamp" CHECK ("state" <> 'SENT' OR "sentAt" IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "EmailDelivery" ADD CONSTRAINT "delivery_canonical_email" CHECK ("recipientEmail" = lower(btrim("recipientEmail")) AND position('@' IN "recipientEmail") > 1);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- History is evidence, not a mutable projection.
CREATE OR REPLACE FUNCTION workforce_reject_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical evidence cannot be rewritten' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS "audit_append_only" ON "AuditEvent";
CREATE TRIGGER "audit_append_only" BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_history_rewrite();
DROP TRIGGER IF EXISTS "decision_append_only" ON "ApprovalDecision";
CREATE TRIGGER "decision_append_only" BEFORE UPDATE OR DELETE ON "ApprovalDecision"
  FOR EACH ROW EXECUTE FUNCTION workforce_reject_history_rewrite();

CREATE OR REPLACE FUNCTION workforce_protect_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Submission evidence cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF ROW(NEW."weeklyTaskId", NEW."attemptNumber", NEW."submittedById", NEW."submissionAssignmentId", NEW."submittedAt", NEW."submissionSnapshot")
    IS DISTINCT FROM ROW(OLD."weeklyTaskId", OLD."attemptNumber", OLD."submittedById", OLD."submissionAssignmentId", OLD."submittedAt", OLD."submissionSnapshot") THEN
    RAISE EXCEPTION 'Submission evidence cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "submission_evidence_guard" ON "ApprovalRequest";
CREATE TRIGGER "submission_evidence_guard" BEFORE UPDATE OR DELETE ON "ApprovalRequest"
  FOR EACH ROW EXECUTE FUNCTION workforce_protect_submission();

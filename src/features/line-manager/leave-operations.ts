import { RetainedLeaveOperations } from '../employee/leave-operations.ts'
import { managerLeaveRequest } from './leave-contracts.ts'
import type { ManagerLeaveOperation, ManagerLeaveResult } from './leave-contracts.ts'

export class ManagerLeaveOperations extends RetainedLeaveOperations<ManagerLeaveOperation, ManagerLeaveResult> {
  constructor() { super(managerLeaveRequest) }
}

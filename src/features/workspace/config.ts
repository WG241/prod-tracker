import { Building2, ChartNoAxesCombined, CircleCheck, Clock, FileText, House, LayoutGrid, List, Settings, Umbrella, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type WorkspaceRole = 'Employee' | 'Line Manager' | 'Business Director' | 'Executive' | 'HR / Admin'
export type Destination = { label: string; icon: LucideIcon }
export type WorkspaceConfig = { role: WorkspaceRole; name: string; destinations: readonly Destination[] }

// Fictional prototype personas. This adapter never establishes a session.
export const workspaces: Record<WorkspaceRole, WorkspaceConfig> = {
  Employee: { role: 'Employee', name: 'Ada Okafor', destinations: [{ label: 'Home', icon: House }, { label: 'History', icon: Clock }, { label: 'Leave', icon: Umbrella }] },
  'Line Manager': { role: 'Line Manager', name: 'Tunde Bakare', destinations: [{ label: 'Dashboard', icon: LayoutGrid }, { label: 'My tasks', icon: List }, { label: 'Team history', icon: Clock }, { label: 'Approvals', icon: CircleCheck }, { label: 'Leave', icon: Umbrella }] },
  'Business Director': { role: 'Business Director', name: 'Amara Bello', destinations: [{ label: 'Dashboard', icon: LayoutGrid }, { label: 'Units', icon: Building2 }, { label: 'Performance records', icon: FileText }, { label: 'Reports', icon: ChartNoAxesCombined }] },
  Executive: { role: 'Executive', name: 'David Cole', destinations: [{ label: 'Dashboard', icon: LayoutGrid }, { label: 'Businesses', icon: Building2 }, { label: 'Reports', icon: ChartNoAxesCombined }] },
  'HR / Admin': { role: 'HR / Admin', name: 'Kemi Adebayo', destinations: [{ label: 'Dashboard', icon: LayoutGrid }, { label: 'Organisation', icon: Building2 }, { label: 'Employees', icon: Users }, { label: 'Leave & Relief', icon: Umbrella }, { label: 'Performance records', icon: FileText }, { label: 'Reports', icon: ChartNoAxesCombined }, { label: 'Settings', icon: Settings }] },
}

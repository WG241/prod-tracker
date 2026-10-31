export const roleRoutes = {
  EMPLOYEE: { label: 'Employee', prefix: '/employee', landing: 'home', pages: [['home', 'Home'], ['history', 'History'], ['leave', 'Leave']] },
  LINE_MANAGER: { label: 'Line Manager', prefix: '/line-manager', landing: 'dashboard', pages: [['dashboard', 'Dashboard'], ['my-tasks', 'My tasks'], ['team-history', 'Team history'], ['approvals', 'Approvals'], ['leave', 'Leave']] },
  BUSINESS_DIRECTOR: { label: 'Business Director', prefix: '/business-director', landing: 'dashboard', pages: [['dashboard', 'Dashboard'], ['units', 'Units'], ['performance-records', 'Performance records'], ['reports', 'Reports']] },
  EXECUTIVE: { label: 'Executive', prefix: '/executive', landing: 'dashboard', pages: [['dashboard', 'Dashboard'], ['businesses', 'Businesses'], ['reports', 'Reports']] },
  HR_ADMIN: { label: 'HR / Admin', prefix: '/hr', landing: 'dashboard', pages: [['dashboard', 'Dashboard'], ['organisation', 'Organisation'], ['employees', 'Employees'], ['leave-relief', 'Leave & Relief'], ['performance-records', 'Performance records'], ['reports', 'Reports'], ['settings', 'Settings']] },
} as const

export type AuthRole = keyof typeof roleRoutes
export interface SessionContext {
  user: { id: string; name: string; email: string }
  role: AuthRole
  businessId: string | null
  unitId: string | null
  landingPath: string
  navigation: { path: string; label: string }[]
  session: { expiresAt: string }
}

export function routeContext(role: AuthRole) {
  const route = roleRoutes[role]
  return {
    landingPath: `${route.prefix}/${route.landing}`,
    navigation: route.pages.map(([suffix, label]) => ({ path: `${route.prefix}/${suffix}`, label })),
  }
}

export function validPassword(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('\0') || !wellFormed(value)) return false
  const length = [...value].length
  return length >= 6 && length <= 128 && /[A-Z]/.test(value) && /[0-9]/.test(value)
}

export function wellFormed(value: string) {
  return !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
}

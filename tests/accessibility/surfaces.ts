export type Surface = {
  id: string
  route: string
  kind: 'components' | 'shell' | 'sign-in' | 'proof'
  heading: string
  viewport: { width: number; height: number }
  role?: string
  mode?: 'spacing' | 'reduced-motion' | 'forced-colors'
  open?: string
  expected: string[]
}

export const roles = [
  { role: 'Employee', name: 'Ada Okafor', email: 'ada.okafor@workforcegroup.com', heading: 'Home', menus: ['Home', 'History', 'Leave'] },
  { role: 'Line Manager', name: 'Tunde Bakare', email: 'tunde.bakare@workforcegroup.com', heading: 'Dashboard', menus: ['Dashboard', 'My tasks', 'Team history', 'Approvals', 'Leave'] },
  { role: 'Business Director', name: 'Amara Bello', email: 'amara.bello@workforcegroup.com', heading: 'Dashboard', menus: ['Dashboard', 'Units', 'Performance records', 'Reports'] },
  { role: 'Executive', name: 'David Cole', email: 'david.cole@workforcegroup.com', heading: 'Dashboard', menus: ['Dashboard', 'Businesses', 'Reports'] },
  { role: 'HR / Admin', name: 'Kemi Adebayo', email: 'kemi.adebayo@workforcegroup.com', heading: 'Dashboard', menus: ['Dashboard', 'Organisation', 'Employees', 'Leave & Relief', 'Performance records', 'Reports', 'Settings'] },
] as const

const desktop = { width: 1280, height: 900 }
const mobile = { width: 320, height: 800 }
export const developmentSurfaces: Surface[] = [
  ...roles.flatMap((person) => [1280, 800, 320].map((width) => ({ id: `shell:${person.role}:${width}`, route: '/__ui?view=workspace', kind: 'shell' as const, role: person.role, heading: person.heading, viewport: { width, height: 900 }, expected: [`Account for ${person.name}, ${person.role}`] }))),
  { id: 'components', route: '/__ui', kind: 'components', heading: 'Component preview', viewport: desktop, expected: ['Complete example', 'Open dialog', 'Open drawer', 'Root status example'] },
  { id: 'components:320', route: '/__ui', kind: 'components', heading: 'Component preview', viewport: mobile, expected: ['Complete example', 'Open dialog'] },
  ...(['spacing', 'reduced-motion', 'forced-colors'] as const).map((mode) => ({ id: `components:${mode}`, route: '/__ui', kind: 'components' as const, heading: 'Component preview', viewport: mobile, mode, expected: ['Complete example', 'Open dialog'] })),
  ...['Open dialog', 'Open small dialog', 'Open wide dialog', 'Open long dialog', 'Open drawer', 'Open long drawer'].map((open) => ({ id: `modal:${open}`, route: '/__ui', kind: 'components' as const, heading: 'Component preview', viewport: desktop, open, expected: ['Close dialog'] })),
  { id: 'hr:more:320', route: '/__ui?view=workspace', kind: 'shell', heading: 'Dashboard', role: 'HR / Admin', viewport: mobile, open: 'More', expected: ['Close dialog'] },
  { id: 'proof:available-ui', route: '/__data-proof', kind: 'proof', heading: 'Development data proof', viewport: mobile, expected: ['Reload tasks'] },
]

export const productionSurfaces: Surface[] = [
  { id: 'sign-in:desktop', route: '/sign-in', kind: 'sign-in', heading: 'Welcome back', viewport: desktop, expected: ['Sign in', 'Forgot password?'] },
  { id: 'sign-in:320', route: '/sign-in', kind: 'sign-in', heading: 'Welcome back', viewport: mobile, expected: ['Sign in', 'Show password'] },
  ...(['spacing', 'reduced-motion', 'forced-colors'] as const).map((mode) => ({ id: `sign-in:${mode}`, route: '/sign-in', kind: 'sign-in' as const, heading: 'Welcome back', viewport: mobile, mode, expected: ['Sign in', 'Show password'] })),
  { id: 'recovery:dialog', route: '/sign-in', kind: 'sign-in', heading: 'Welcome back', viewport: mobile, open: 'Forgot password?', expected: ['Close dialog', 'Back to sign in'] },
]

export const plannedSurfaces = [
  { feature: 8, state: 'not built', surface: 'Monitoring recovery fallback' },
  { feature: 10, state: 'not built', surface: 'Real task creation, progress and submission' },
]

export function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  const result = date.toISOString().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(result) && result >= '0001-01-01' && result <= '9999-12-31' ? result : null
}
export function displayDate(value: string, year = true) {
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'Africa/Lagos' })
}
export function displayTime(value: string) {
  return new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' }) + ' WAT'
}
export function isoWeek(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7)
  const year = new Date(0)
  year.setUTCFullYear(date.getUTCFullYear(), 0, 4)
  return 1 + Math.round((date.getTime() - year.getTime()) / 86400000 / 7)
}
export function isoWeekYear(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 3 - (date.getUTCDay() + 6) % 7)
  return String(date.getUTCFullYear()).padStart(4, '0')
}
export function rangeError(from: string, to: string) {
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= '0001-01-01' && date <= '9999-12-31' && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date
  if (!valid(from)) return { from: 'Choose a valid start date.' }
  if (!valid(to)) return { to: 'Choose a valid end date.' }
  if (to < from) return { to: 'Choose an end date on or after the start date.' }
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= 366) return { to: 'Choose a range of at most 366 days.' }
  return {}
}

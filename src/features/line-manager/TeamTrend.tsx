import { Table } from '../../components/ui/Table.tsx'
import { displayDate, isoWeek } from '../employee/date.ts'
import type { TrendWeek } from './dashboard-view.ts'

const series = [
  { key: 'submission', label: 'Submission' },
  { key: 'completion', label: 'Approved completion' },
] as const

function plot(weeks: TrendWeek[], key: typeof series[number]['key']) {
  let start = true
  return weeks.flatMap((week, index) => {
    const value = week[key]
    if (value === null) {
      start = true
      return []
    }
    const point = { week: week.week, x: 42 + index * 76, y: 15 + (100 - value) * 1.6, start }
    start = false
    return [point]
  })
}

export function TeamTrend({ weeks }: { weeks: TrendWeek[] }) {
  if (!weeks.length) return <p className="manager-empty">No weeks to chart for this period.</p>
  return <>
    <ul className="manager-chart-legend">
      {series.map(({ key, label }) => <li key={key} className={`manager-series-${key}`}><span aria-hidden="true" />{label}</li>)}
    </ul>
    <svg className="manager-chart" viewBox="0 0 450 205" aria-hidden="true">
      {[100, 75, 50, 25, 0].map((tick, index) => <g key={tick}>
        <line x1="36" x2="437" y1={15 + index * 40} y2={15 + index * 40} />
        <text x="32" y={19 + index * 40} textAnchor="end">{tick}%</text>
      </g>)}
      {series.map(({ key }) => {
        const points = plot(weeks, key)
        return <g key={key} className={`manager-series-${key}`}>
          <path d={points.map(({ x, y, start }) => `${start ? 'M' : 'L'} ${x} ${y}`).join(' ')} />
          {points.map(({ week, x, y }) => <circle key={week} cx={x} cy={y} r="3" />)}
        </g>
      })}
      {weeks.map(({ week }, index) => <text key={week} x={42 + index * 76} y="196" textAnchor="middle">W{isoWeek(week)}</text>)}
    </svg>
    <details className="manager-chart-data">
      <summary>View chart data</summary>
      <Table caption="Weekly team trend data" headings={['Week', 'Submitted', 'Approved']}>
        {weeks.map(({ week, submission, completion }) => <tr key={week}>
          <th scope="row">{displayDate(week)}</th>
          <td>{submission === null ? 'Unavailable' : `${submission}%`}</td>
          <td>{completion === null ? 'Unavailable' : `${completion}%`}</td>
        </tr>)}
      </Table>
    </details>
  </>
}

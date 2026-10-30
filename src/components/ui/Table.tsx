import type { ReactNode } from 'react'

export function Table({ caption, headings, children }: { caption: string; headings: readonly string[]; children: ReactNode }) {
  return (
    <div className="ui-table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table className="ui-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

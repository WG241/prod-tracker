import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export function Table({ caption, headings, children }: { caption: string; headings: readonly string[]; children: ReactNode }) {
  const region = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  useLayoutEffect(() => {
    const element = region.current
    if (!element) return
    const measure = () => setOverflow(element.scrollWidth > element.clientWidth)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    measure()
    return () => observer.disconnect()
  }, [])
  return (
    <div ref={region} className="ui-table-scroll" role="region" aria-label={caption} tabIndex={overflow ? 0 : undefined}>
      <table className="ui-table">
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

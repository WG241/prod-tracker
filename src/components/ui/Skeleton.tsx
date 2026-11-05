import type { ReactNode } from 'react'
import './skeleton.css'

export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />
}

export function SkeletonText({ width = 'long' }: { width?: 'short' | 'medium' | 'long' | 'full' }) {
  const widthClass = width === 'short' ? 'skeleton-text-short' : width === 'medium' ? 'skeleton-text-medium' : width === 'full' ? '' : 'skeleton-text-long'
  return <Skeleton className={`skeleton-text ${widthClass}`} />
}

export function SkeletonCircle({ size = 32 }: { size?: number }) {
  return <Skeleton className="skeleton-circle" style={{ width: size, height: size }} />
}

export function SkeletonTaskRow() {
  return <div className="skeleton-row">
    <SkeletonCircle size={32} />
    <div className="skeleton-row-body">
      <SkeletonText width="long" />
      <SkeletonText width="medium" />
      <SkeletonText width="short" />
    </div>
    <div className="skeleton-row-side">
      <Skeleton className="skeleton-badge" />
    </div>
  </div>
}

export function SkeletonTaskList({ count = 5 }: { count?: number }) {
  return <div aria-busy="true" aria-label="Loading tasks">
    {Array.from({ length: count }, (_, i) => <SkeletonTaskRow key={i} />)}
  </div>
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return <table className="skeleton-table" aria-busy="true" aria-label="Loading table">
    <thead><tr>{Array.from({ length: cols }, (_, i) => <th key={i}><SkeletonText width="medium" /></th>)}</tr></thead>
    <tbody>{Array.from({ length: rows }, (_, r) => <tr key={r}>{Array.from({ length: cols }, (_, c) => <td key={c}><SkeletonText width={c === 1 ? 'long' : 'short'} /></td>)}</tr>)}</tbody>
  </table>
}

export function SkeletonField() {
  return <div className="skeleton-field">
    <Skeleton className="skeleton-field-label" />
    <Skeleton className="skeleton-field-control" />
  </div>
}

export function SkeletonForm({ fields = 2 }: { fields?: number }) {
  return <div aria-busy="true" aria-label="Loading form" style={{ display: 'grid', gap: 16 }}>
    {Array.from({ length: fields }, (_, i) => <SkeletonField key={i} />)}
  </div>
}

export function SkeletonBlock({ height = 120 }: { height?: number }) {
  return <Skeleton className="skeleton-block" style={{ height }} />
}

export function SkeletonDetail() {
  return <div aria-busy="true" aria-label="Loading details" style={{ display: 'grid', gap: 20 }}>
    <SkeletonText width="medium" />
    <SkeletonText width="long" />
    <SkeletonBlock height={80} />
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      <SkeletonField /><SkeletonField />
    </div>
    <SkeletonBlock height={100} />
  </div>
}

export function SkeletonCard({ children }: { children: ReactNode }) {
  return <div className="skeleton-card" aria-busy="true">{children}</div>
}

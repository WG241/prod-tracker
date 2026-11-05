import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton } from '../../components/ui/Button.tsx'
import type { Page } from './contracts.ts'

export function Pagination({ value, label, onPage }: { value: Page<unknown>; label: string; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(value.total / 25))
  return <nav className="employee-pagination" aria-label={`${label} pages`}>
    <span>Showing {value.items.length} of {value.total} · 25 per page</span>
    <span><IconButton label={`Previous ${label} page`} disabled={value.page <= 1} onClick={() => onPage(value.page - 1)}><ChevronLeft aria-hidden="true" /></IconButton>{value.page} of {pages}<IconButton label={`Next ${label} page`} disabled={value.page >= pages} onClick={() => onPage(value.page + 1)}><ChevronRight aria-hidden="true" /></IconButton></span>
  </nav>
}

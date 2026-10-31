import type { ReactNode } from 'react'

export function Card({ title, description, actions, children, className = '' }: {
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`ui-card ${className}`}>
      {(title || actions) && <div className="ui-card-head"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{actions}</div>}
      <div className="ui-card-body">{children}</div>
    </section>
  )
}

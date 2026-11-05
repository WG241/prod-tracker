import { Component, createRef } from 'react'
import type { ReactNode } from 'react'
import { Button } from './ui/Button.tsx'
import { Card } from './ui/Card.tsx'

export class RecoveryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  private readonly heading = createRef<HTMLHeadingElement>()
  static getDerivedStateFromError() { return { failed: true } }
  componentDidMount() { if (this.state.failed) this.heading.current?.focus() }
  componentDidUpdate() { if (this.state.failed) this.heading.current?.focus() }
  render() {
    if (!this.state.failed) return this.props.children
    return <main className="recovery-boundary"><Card><h1 ref={this.heading} tabIndex={-1} aria-describedby="recovery-description">Something went wrong</h1><p id="recovery-description">Reload to try again.</p><Button variant="primary" onClick={() => window.location.reload()}>Reload</Button></Card></main>
  }
}

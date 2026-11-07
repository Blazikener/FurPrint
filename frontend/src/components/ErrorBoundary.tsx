import { Component, type ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error(error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="container stack center" style={{ paddingTop: 96, '--gap': '14px' } as React.CSSProperties}>
        <h2>Something broke on this page</h2>
        <p className="muted">Your case is safe. Reload to try again.</p>
        <button className="btn accent" style={{ justifySelf: 'center' }} onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}

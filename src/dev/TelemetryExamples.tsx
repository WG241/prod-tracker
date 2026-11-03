import { useState } from 'react'
import { Card } from '../components/ui/Card.tsx'
import { Button } from '../components/ui/Button.tsx'

function BrokenExample(): never { throw new Error('Controlled render exercise') }
export function TelemetryExamples() {
  const [broken, setBroken] = useState(false)
  if (broken) return <BrokenExample />
  return <Card title="Development error exercises" description="Diagnostic exercises only. These do not prove business workflows."><div className="preview-row">
    <Button onClick={() => setBroken(true)}>Exercise render recovery</Button>
    <Button onClick={() => { window.setTimeout(() => { throw new Error('Controlled timer exercise') }, 0) }}>Exercise browser error</Button>
    <Button onClick={() => { void Promise.reject(new Error('Controlled rejection exercise')) }}>Exercise unhandled rejection</Button>
  </div></Card>
}

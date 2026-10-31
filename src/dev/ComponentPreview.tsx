import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Bell, Plus } from 'lucide-react'
import { Avatar } from '../components/ui/Avatar.tsx'
import { Badge } from '../components/ui/Badge.tsx'
import { Button, IconButton } from '../components/ui/Button.tsx'
import { Card } from '../components/ui/Card.tsx'
import { Dialog, Drawer } from '../components/ui/Dialog.tsx'
import { CheckboxField, InputField, SelectField, TextareaField } from '../components/ui/Field.tsx'
import { Table } from '../components/ui/Table.tsx'

export function ComponentPreview() {
  const [overlay, setOverlay] = useState<'dialog' | 'small' | 'wide' | 'drawer' | 'long' | 'removed' | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const firstInput = useRef<HTMLInputElement>(null)
  useEffect(() => { document.title = 'Component preview · Workforce' }, [])
  const close = () => setOverlay(null)
  const longContent = <div className="preview-long-content">{Array.from({ length: 24 }, (_, i) => <p key={i}>Activity {i + 1}. Consolidate the discovery findings, finalise the commercial proposal, and share it with the client.</p>)}</div>
  return (
    <main className="component-preview" id="workspace-main" tabIndex={-1}>
      <a href="/__ui?view=workspace" className="preview-return"><ArrowLeft aria-hidden="true" />Return to workspace preview</a>
      <header className="workspace-page-heading"><p className="eyebrow">Development preview</p><h1 ref={heading} tabIndex={-1}>Component preview</h1><p>Shared controls from the Workforce prototype. Fictional examples only.</p></header>
      <div className="preview-sections">
        <Card title="Buttons" description="Default, hover, focus, disabled, and small variants.">
          <div className="preview-row">{(['default', 'primary', 'success', 'danger', 'ghost'] as const).map((variant) => <Button key={variant} variant={variant}>{variant === 'primary' && <Plus aria-hidden="true" />}{variant[0].toUpperCase() + variant.slice(1)}</Button>)}</div>
          <div className="preview-row"><Button size="small">Small button</Button><Button variant="primary" size="small">Small primary</Button><Button disabled aria-describedby="preview-disabled">Disabled</Button><IconButton label="Notification example"><Bell aria-hidden="true" /></IconButton><IconButton label="Disabled notification example" disabled><Bell aria-hidden="true" /></IconButton></div>
          <p className="ui-help" id="preview-disabled">Unavailable controls use native disabled behavior.</p>
        </Card>
        <Card title="Fields" description="Labels, descriptions, errors, and native keyboard controls.">
          <div className="preview-grid">
            <InputField label="Task title" placeholder="What will you deliver?" required description="A clear outcome for this week. Required." />
            <InputField label="Task title with error" defaultValue="" error="Enter a title and activity." required />
            <InputField label="Locked title" value="Complete candidate shortlist" disabled readOnly description="Approved tasks cannot be edited." />
            <InputField label="Start date" type="date" defaultValue="2026-10-19" />
            <SelectField label="Status" defaultValue="In progress"><option>Pending</option><option>In progress</option><option>Blocked</option><option>Completed</option></SelectField>
            <SelectField label="Locked status" disabled defaultValue="Approved"><option>Approved</option></SelectField>
            <TextareaField label="Activity" placeholder="Describe the work for this week…" />
            <TextareaField label="Locked activity" disabled defaultValue="Share the weekly pipeline summary." />
            <CheckboxField label="Carry into next week" description="Keep the weekly record when work continues." />
            <CheckboxField label="Locked carry option" disabled defaultChecked />
          </div>
        </Card>
        <Card title="Statuses and people">
          <div className="preview-row">{['Pending', 'In progress', 'Blocked', 'Awaiting approval', 'Approved', 'Declined', 'On hold', 'Cancelled', 'On leave', 'Active', 'Inactive', 'Unknown status'].map((status) => <Badge key={status} status={status} />)}</div>
          <div className="preview-row">{(['blue', 'teal', 'lilac', 'sand'] as const).map((tone) => <span className="preview-person" key={tone}><Avatar name="Ada Okafor" tone={tone} />Ada Okafor</span>)}<span className="preview-person"><Avatar name="Ada" />Ada</span><span className="preview-person"><Avatar name="" />Unnamed person</span></div>
        </Card>
        <Card title="Task records" description="A semantic table with local horizontal scrolling.">
          <Table caption="Fictional task records" headings={['Task', 'Owner', 'Status', 'Dates']}>
            <tr><th scope="row">Deliver the Lagos client proposal</th><td><span className="preview-person"><Avatar name="Ada Okafor" />Ada Okafor</span></td><td><Badge status="In progress" /></td><td>19 to 21 Oct 2026</td></tr>
            <tr><th scope="row">Complete candidate shortlist</th><td>Ada Okafor</td><td><Badge status="Approved" /></td><td>19 to 20 Oct 2026</td></tr>
          </Table>
        </Card>
        <Card title="Dialogs and drawers" description="Open, Tab, Shift+Tab, Escape, close, and return to the opener.">
          <div className="preview-row"><Button onClick={() => setOverlay('dialog')}>Open dialog</Button><Button onClick={() => setOverlay('small')}>Open small dialog</Button><Button onClick={() => setOverlay('wide')}>Open wide dialog</Button><Button onClick={() => setOverlay('drawer')}>Open drawer</Button><Button onClick={() => setOverlay('long')}>Open long dialog</Button>{overlay !== 'removed' && <Button onClick={() => setOverlay('removed')}>Open with removed opener</Button>}</div>
        </Card>
      </div>
      <Dialog open={overlay !== null && overlay !== 'drawer'} title={overlay === 'small' ? 'Delete task?' : overlay === 'wide' ? 'Weekly task records' : 'Add a task'} description="A clear outcome, and the work you’ll do to achieve it." size={overlay === 'small' ? 'small' : overlay === 'wide' ? 'wide' : 'normal'} onClose={close} initialFocusRef={firstInput} fallbackFocusRef={heading} footer={<><Button onClick={close}>Cancel</Button><Button variant="primary" onClick={close}>Close preview</Button></>}>
        {overlay === 'long' ? longContent : <><InputField label="Task title" ref={firstInput} placeholder="What will you deliver?" /><TextareaField label="Activity" placeholder="Describe the work for this week…" /><CheckboxField label="Carry into next week" /></>}
      </Dialog>
      <Drawer open={overlay === 'drawer'} title="Task details" onClose={close} fallbackFocusRef={heading} footer={<Button onClick={close}>Close</Button>}>
        <Badge status="In progress" /><h3 className="preview-detail-title">Deliver the Lagos client proposal</h3><p className="ui-help">Ada Okafor · 19 to 21 Oct 2026</p><div className="preview-activity"><p className="eyebrow">Activity</p><p>Consolidate the discovery findings, finalise the commercial proposal, and share it with the client.</p></div><h3>Manager comments</h3><p className="ui-help">No comments yet.</p><TextareaField label="Reply" placeholder="Add a helpful update…" />
      </Drawer>
    </main>
  )
}

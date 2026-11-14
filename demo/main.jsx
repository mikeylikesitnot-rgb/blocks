import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/kit.css';
import {
  Button, Badge, PageHeader, Panel, StatCard, StatGrid, Tabs, Segmented, Toolbar,
  Input, Textarea, SearchInput, Select, Field, EmptyState, SkeletonRows, SkeletonStats, Banner,
  Modal, OverlayProvider, useConfirm, useToast, useUrlState, useTheme, matchesQuery,
  PlusIcon, TrashIcon, XIcon, SunIcon, MoonIcon, LoginPage,
} from '../src/index.js';
import { HubDemo } from './HubDemo.jsx';

const ROWS = [
  { name: 'Ana Lopez', phone: '(214) 555-2415', status: 'Active' },
  { name: 'Ben Carter', phone: '(469) 555-0199', status: 'Overdue' },
  { name: 'Chris Wu', phone: '(972) 555-7781', status: 'Completed' },
];

function Demo() {
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useUrlState('tab', 'components');
  const [q, setQ] = useUrlState('q');
  const [view, setView] = useState('list');
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const rows = ROWS.filter((r) => matchesQuery(q, [r.name, r.phone, r.status]));

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 96px' }}>
      <PageHeader
        title="mn-kit"
        subtitle="Shared UI for every app. Tokens, one button system, layout, inputs, states, overlays."
        meta={<Badge tone="info">v0.3</Badge>}
        actions={
          <>
            <Segmented label="Theme" value={theme} onChange={setTheme}
              items={[{ value: 'system', label: 'Auto' }, { value: 'light', label: 'Light', icon: SunIcon }, { value: 'dark', label: 'Dark', icon: MoonIcon }]} />
            <Button icon={PlusIcon} onClick={() => setOpen(true)}>Open modal</Button>
          </>
        }
      >
        <Tabs value={tab} onChange={setTab} label="Sections"
          items={[{ value: 'components', label: 'Components' }, { value: 'list', label: 'List page', count: rows.length }, { value: 'states', label: 'States' }, { value: 'hub', label: 'Project hub' }, { value: 'login', label: 'Login' }]} />
      </PageHeader>

      {tab === 'components' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <StatGrid cols={4}>
            <StatCard label="Revenue, Nov" value="$48,210" delta={12.4} deltaLabel="vs Oct" />
            <StatCard label="Costs" value="$9,880" delta={4.1} invert deltaLabel="vs Oct" />
            <StatCard label="Open leads" value="37" sub="9 new today" />
            <StatCard label="Overdue" value="5" onClick={() => toast.info('Clickable stat')} />
          </StatGrid>

          <Panel title="Buttons" subtitle="Solid commits; soft is a row action.">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <Button>Primary</Button>
              <Button variant="accent">Accent</Button>
              <Button variant="danger">Danger</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="soft">Soft</Button>
              <Button variant="soft-danger" icon={TrashIcon}>Soft danger</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="ghost" icon={XIcon} label="Close" />
              <Button loading>Saving…</Button>
              <Button disabled>Disabled</Button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <Button size="xs">xs</Button><Button size="sm">sm</Button><Button>md</Button><Button size="lg">lg</Button>
            </div>
          </Panel>

          <Panel title="Badges">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {['Active', 'Pending', 'Completed', 'Overdue', 'Closed', 'Draft'].map((s) => <Badge key={s} text={s} dot />)}
              <Badge tone="accent">Custom tone</Badge>
            </div>
          </Panel>

          <Panel title="Form">
            <form onSubmit={(e) => { e.preventDefault(); toast('Saved'); }} style={{ maxWidth: 420 }}>
              <Field label="Email" hint="We only use it for receipts." error={email && !email.includes('@') ? 'Enter a valid email' : null}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Plan"><Select defaultValue="pro"><option value="free">Free</option><option value="pro">Pro</option></Select></Field>
              <Field label="Notes"><Textarea placeholder="Anything else?" /></Field>
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <Button type="submit">Save</Button>
                <Button variant="secondary" onClick={() => toast.error('Couldn’t reach the server')}>Error toast</Button>
              </div>
            </form>
          </Panel>
        </div>
      )}

      {tab === 'list' && (
        <Panel flush>
          <div style={{ padding: 16 }}>
            <Toolbar right={`${rows.length} of ${ROWS.length}`}>
              <SearchInput value={q} onChange={setQ} placeholder="Name, phone, status" />
              <Select active={false} defaultValue="all"><option value="all">All statuses</option></Select>
              <Segmented label="View" value={view} onChange={setView} items={[{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }]} />
            </Toolbar>
          </div>
          {rows.length === 0 ? (
            <EmptyState variant="filtered" onClear={() => setQ('')} />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} style={{ borderTop: '1px solid var(--mk-border)' }}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, color: 'var(--mk-heading)' }}>{r.name}</td>
                    <td className="mk-tabular" style={{ padding: '12px 16px', whiteSpace: 'nowrap' }}>{r.phone}</td>
                    <td style={{ padding: '12px 16px' }}><Badge text={r.status} /></td>
                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <Button size="sm" variant="soft-danger" onClick={async () => {
                        if (await confirm({ title: `Delete ${r.name}?`, body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true })) toast('Deleted');
                      }}>Delete</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {tab === 'states' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Banner onRetry={() => toast('Retried')}>Couldn’t refresh. Showing data from 2 minutes ago.</Banner>
          <Banner tone="info">Heads up: this is an info banner.</Banner>
          <SkeletonStats />
          <Panel flush><SkeletonRows rows={4} /></Panel>
          <Panel><EmptyState title="No customers yet" body="Add your first customer to get started." action={<Button size="sm" icon={PlusIcon}>Add customer</Button>} /></Panel>
          <Panel><EmptyState variant="error" body="The server returned 500." onRetry={() => toast('Retrying')} /></Panel>
        </div>
      )}

      {tab === 'hub' && (
        <Panel flush style={{ overflow: 'hidden' }}><HubDemo /></Panel>
      )}

      {tab === 'login' && (
        <Panel flush>
          <LoginPage appName="mn-kit demo" subtitle="Try demo@example.com / demo-password (run npm run example)"
            onSignedIn={(u) => toast(`Signed in as ${u.email}`)} />
        </Panel>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="Edit customer" subtitle="Bottom sheet on phones"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => { setOpen(false); toast('Saved'); }}>Save</Button></>}>
        <Field label="Name"><Input defaultValue="Ana Lopez" /></Field>
        <Field label="Phone"><Input defaultValue="(214) 555-2415" /></Field>
      </Modal>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode><OverlayProvider><Demo /></OverlayProvider></StrictMode>,
);

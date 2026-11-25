import { useState } from 'react';
import { Panel, Button, Field, Input, SectionTab, InfoIcon, FileIcon, StarIcon, InboxIcon, CopyIcon } from '../src/index.js';

// A long page with a SectionTab: narrow the window under 1024px to see the tab on the left edge.
const SECTIONS = [
  { id: 'st-vehicle', label: 'Vehicle', icon: InfoIcon, fields: ['VIN', 'License plate', 'Color', 'Trim'] },
  { id: 'st-purchase', label: 'Purchase', icon: CopyIcon, fields: ['Purchase date', 'Cost', 'Owner'] },
  { id: 'st-registration', label: 'Registration & insurance', icon: FileIcon, dot: 'amber', meta: 'due in 12 days', fields: ['Registration expires', 'Insurance expires', 'Insurance company'] },
  { id: 'st-keys', label: 'Keys & tracking', icon: StarIcon, fields: ['Key FOBs', 'Keys without remote', 'Toll tag', 'Park location'] },
  { id: 'st-notes', label: 'Notes', icon: InboxIcon, meta: '3 lines', fields: ['Note'] },
];

export function SectionTabDemo() {
  const [order, setOrder] = useState(SECTIONS.map((s) => s.id));
  const [folded, setFolded] = useState({});
  const items = order.map((id) => SECTIONS.find((s) => s.id === id));
  return (
    <div style={{ display: 'grid', gap: 'var(--mk-space-4)' }}>
      <p style={{ margin: 0, color: 'var(--mk-muted)' }}>
        Under 1024px wide, a tab on the left edge shows the section you are reading; tap it to jump, fold or reorder.
      </p>
      {items.map((s) => (
        <Panel key={s.id} id={s.id} title={s.label} style={{ scrollMarginTop: 'var(--mk-space-4)' }}
          actions={<Button size="sm" variant="ghost" onClick={() => setFolded((f) => ({ ...f, [s.id]: !f[s.id] }))}>{folded[s.id] ? 'Open' : 'Fold'}</Button>}>
          {!folded[s.id] && (
            <div style={{ display: 'grid', gap: 'var(--mk-space-3)' }}>
              {s.fields.map((f) => <Field key={f} label={f}><Input defaultValue="" placeholder={f} /></Field>)}
            </div>
          )}
        </Panel>
      ))}
      <SectionTab
        items={items}
        onJump={(id) => setFolded((f) => ({ ...f, [id]: false }))}
        onReorder={(ids) => setOrder(ids)}
        onFoldAll={(fold) => setFolded(Object.fromEntries(SECTIONS.map((s) => [s.id, fold])))}
      />
    </div>
  );
}

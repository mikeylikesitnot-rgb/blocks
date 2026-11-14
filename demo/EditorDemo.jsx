import { useState } from 'react';
import { Panel, Button, Badge } from '../src/index.js';
// The lite entry: RichTextField pulls Tiptap in as its own chunk when this tab first renders.
import { RichText, RichTextField, isBlankHtml } from '../src/editor/lite.js';

const START = '<p>Picked up at <strong>9:30</strong>, returned with a <em>full tank</em>.</p>'
  + '<ul><li><p>Small scratch on the rear bumper</p></li><li><p>Guest left a phone charger</p></li></ul>'
  + '<p>Claim filed: <a target="_blank" rel="noopener noreferrer" href="https://example.com/claim/123">claim 123</a></p>';

export function EditorDemo() {
  const [notes, setNotes] = useState(START);
  const [note, setNote] = useState('Plain text from before the editor.\nIts line breaks survive.');
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title="Rich text editor" subtitle="Full toolbar (TuroApp), resizable, height remembered in localStorage.">
        <RichTextField value={notes} onChange={setNotes} ariaLabel="Trip notes" storageKey="mk-demo-notes-height" />
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={() => setNotes(START)}>Reset from outside</Button>
          <Button variant="ghost" size="sm" onClick={() => setNotes('')}>Clear</Button>
          {isBlankHtml(notes) && <Badge tone="neutral">Empty</Badge>}
        </div>
      </Panel>

      <Panel title="Compact note" subtitle="AutoDealer's set: no headings, code blocks or rules; 3 rows.">
        <RichTextField value={note} onChange={setNote} ariaLabel="Note" minRows={3}
          toolbar={['bold', 'italic', 'underline', '|', 'bulletList', 'orderedList', '|', 'link']}
          disable={['heading', 'codeBlock', 'horizontalRule']} />
      </Panel>

      <Panel title="Saved view (RichText)" subtitle="Read-only rendering. No Tiptap needed.">
        <RichText html={notes} />
        <pre style={{ marginTop: 12, padding: 12, background: 'var(--mk-surface-2)', borderRadius: 8, fontSize: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notes || '""'}</pre>
      </Panel>
    </div>
  );
}

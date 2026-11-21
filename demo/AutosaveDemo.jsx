import { useEffect, useRef, useState } from 'react';
import { useAutosave, SaveStatus, Panel, Field, Input, Select, Textarea, Button, Modal, PageHeader } from '../src/index.js';

/* A fake record saved to a fake server (600ms, can be told to fail), so every state can be tried. */
const START = { name: 'Ana Lopez', vin: '3N1CN7AP5FL891596', status: 'Active', notes: 'Prefers texts.' };

function useFakeServer() {
  const [failNext, setFailNext] = useState(false);
  const fail = useRef(false);
  fail.current = failNext;
  const [log, setLog] = useState([]);
  const save = (patch) => new Promise((resolve, reject) => setTimeout(() => {
    if (fail.current) { setFailNext(false); reject(new Error('Server offline')); return; }
    setLog((l) => [`${new Date().toLocaleTimeString()}  ${JSON.stringify(patch)}`, ...l].slice(0, 6));
    resolve();
  }, 600));
  return { save, failNext, setFailNext, log };
}

const validate = (p) => ('vin' in p && p.vin && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(p.vin) ? { vin: 'A VIN is 17 letters and numbers. Not saved yet.' } : {});

function Fields({ a }) {
  return (
    <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }} onBlur={() => a.flush()}>
      <Field label="Name" htmlFor="as-name"><Input id="as-name" value={a.form.name ?? ''} onChange={(e) => a.setField('name', e.target.value)} /></Field>
      <Field label="VIN" htmlFor="as-vin" error={a.errors.vin}><Input id="as-vin" value={a.form.vin ?? ''} onChange={(e) => a.setField('vin', e.target.value)} /></Field>
      <Field label="Status (saves at once)" htmlFor="as-status">
        <Select id="as-status" value={a.form.status ?? ''} onChange={(e) => a.setField('status', e.target.value, 0)}>
          {['Active', 'Paused', 'Sold'].map((s) => <option key={s}>{s}</option>)}
        </Select>
      </Field>
      <div style={{ gridColumn: '1 / -1' }}>
        <Field label="Notes (saves 2s after typing)" htmlFor="as-notes">
          <Textarea id="as-notes" value={a.form.notes ?? ''} onChange={(e) => a.setField('notes', e.target.value, 2000)} />
        </Field>
      </div>
    </div>
  );
}

export function AutosaveDemo() {
  const server = useFakeServer();
  const a = useAutosave({ save: server.save, validate });
  useEffect(() => { a.reset(START); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const formRef = useRef(null);
  const m = useAutosave({ save: server.save, keysEnabled: open, scope: formRef });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <PageHeader title="Autosave" subtitle="useAutosave + SaveStatus: no Save button" actions={<SaveStatus autosave={a} revertTone="danger" />} />
      <Panel title="Record" actions={<label style={{ fontSize: 13 }}><input type="checkbox" checked={server.failNext} onChange={(e) => server.setFailNext(e.target.checked)} /> Fail the next save</label>}>
        <Fields a={a} />
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--mk-muted)' }}>⌘Z / ⌘⇧Z (outside a text box) undo and redo saves; ⌘S saves now.</p>
      </Panel>
      <Panel title="In a window">
        <Button onClick={() => { m.reset(START); setOpen(true); }}>Open edit window</Button>
        <Modal
          open={open}
          onClose={async () => { await m.flush(); setOpen(false); }}
          title="Edit contact"
          footer={<><div style={{ marginRight: 'auto' }}><SaveStatus autosave={m} revert={false} /></div><Button variant="secondary" onClick={async () => { await m.flush(); setOpen(false); }}>Close</Button></>}
        >
          <div ref={formRef}><Fields a={m} /></div>
        </Modal>
      </Panel>
      <Panel title="Server log">
        <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{server.log.join('\n') || 'Nothing saved yet.'}</pre>
      </Panel>
    </div>
  );
}

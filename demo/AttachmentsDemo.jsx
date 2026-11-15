import { useRef, useState } from 'react';
import { Panel, FileDrop, AttachmentGrid, usePasteFiles, Textarea, Field, useToast, useConfirm } from '../src/index.js';

const ACCEPT = ['image/*', 'application/pdf', 'text/plain', '.log', '.csv', '.json', '.md', '.zip'];
const SAMPLE = [
  { id: 'a', name: 'checkout-error.png', mime: 'image/png', size: 248_000, url: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#e5e7eb"/><rect x="200" y="220" width="400" height="160" rx="12" fill="#fff" stroke="#dc2626" stroke-width="4"/><text x="400" y="310" font-family="sans-serif" font-size="28" text-anchor="middle" fill="#dc2626">Payment failed</text></svg>') },
  { id: 'b', name: 'server.log', mime: 'text/plain', size: 1_820_000, url: 'data:text/plain,demo' },
  { id: 'c', name: 'invoice-1042.pdf', mime: 'application/pdf', size: 92_000, url: 'data:application/pdf,demo' },
];

export function AttachmentsDemo() {
  const panel = useRef(null);
  const [items, setItems] = useState(SAMPLE);
  const toast = useToast();
  const confirm = useConfirm();

  const add = (files) => {
    const fresh = files.map((f, i) => ({ id: `${Date.now()}-${i}`, name: f.name, mime: f.type, size: f.size, url: URL.createObjectURL(f), pending: true }));
    setItems((xs) => [...xs, ...fresh]);
    setTimeout(() => setItems((xs) => xs.map((x) => (fresh.some((n) => n.id === x.id) ? { ...x, pending: false } : x))), 700);
  };
  const remove = async (a) => {
    if (await confirm({ title: `Remove ${a.name}?`, confirmLabel: 'Remove', danger: true })) setItems((xs) => xs.filter((x) => x.id !== a.id));
  };

  return (
    <div ref={panel} style={{ display: 'grid', gap: 16, maxWidth: 560 }}>
      <Panel title="Attachments" subtitle="Drop files, pick them, or paste a screenshot (⌘V) anywhere in this panel — even while typing below.">
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="Steps, expected, actual"><Textarea rows={3} placeholder="Paste a screenshot here too" /></Field>
          <AttachmentGrid items={items} onRemove={remove} />
          <FileDrop onFiles={add} onReject={(r) => toast.error(r[0].reason)} accept={ACCEPT} maxSize={20e6} />
          <PasteHook target={panel} onFiles={add} />
        </div>
      </Panel>
    </div>
  );
}

function PasteHook({ target, onFiles }) {
  usePasteFiles(target, onFiles);
  return null;
}

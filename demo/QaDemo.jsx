import { useEffect, useMemo, useState } from 'react';
import { Segmented, Toolbar } from '../src/index.js';
import { QaBoard } from '../src/qa/index.js';
import { memoryQaStore } from '../server/qaStores.js';
import { fakeQaClient, seedQa, demoClock } from './qaFake.js';

const PEOPLE = {
  ana: { id: 'u1', name: 'Ana Lopez', moderator: false },
  ben: { id: 'u2', name: 'Ben Carter', moderator: false },
  mod: { id: 'u9', name: 'Mo (moderator)', moderator: true },
  out: null,
};

/* The real board on an in-browser store. Switch who is signed in to try the permissions. */
export function QaDemo() {
  const [who, setWho] = useState('ana');
  const [ready, setReady] = useState(false);
  const [rev, setRev] = useState(0);
  const { clock, store } = useMemo(() => {
    const c = demoClock();
    return { clock: c, store: memoryQaStore({ now: c.now }) };
  }, []);
  const live = useMemo(() => fakeQaClient({ store, getViewer: () => PEOPLE[who], delay: 250 }), [store, who]);
  useEffect(() => {
    // StrictMode runs effects twice in dev; seed once per store.
    if (!store.seeding) store.seeding = seedQa(store, clock);
    store.seeding.then(() => setReady(true));
  }, [store, clock]);

  return (
    <>
      <Toolbar right="Demo data lives in this tab only">
        <span className="mk-label" style={{ margin: 0 }}>Signed in as</span>
        <Segmented
          label="Signed in as"
          value={who}
          onChange={(v) => { setWho(v); setRev((r) => r + 1); }}
          items={[{ value: 'ana', label: 'Ana' }, { value: 'ben', label: 'Ben' }, { value: 'mod', label: 'Moderator' }, { value: 'out', label: 'Signed out' }]}
        />
      </Toolbar>
      {ready && <QaBoard key={rev} client={live} title="Questions" subtitle="Ask the team. Vote up what helped." onSignIn={() => { setWho('ana'); setRev((r) => r + 1); }} />}
    </>
  );
}

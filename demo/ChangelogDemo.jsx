import { useState } from 'react';
import { Changelog, Panel, Segmented, Button } from '../src/index.js';

/* Fake screenshots: a little admin list drawn as SVG, so the demo needs no image files. */
function shot({ rows, accent = '#1a56db', extra = false, title = 'Leads' }) {
  const lines = rows.map((r, i) => {
    const y = 96 + i * 52;
    return `<rect x="24" y="${y}" width="752" height="44" rx="6" fill="#fff" stroke="#e5e7eb"/>
      <text x="40" y="${y + 27}" font-size="15" font-family="Inter,Arial" fill="#111827">${r}</text>
      ${extra ? `<rect x="560" y="${y + 10}" width="190" height="24" rx="12" fill="${accent}"/><text x="575" y="${y + 27}" font-size="13" font-family="Inter,Arial" fill="#fff">2021 F-150 XLT →</text>` : ''}`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="${120 + rows.length * 52}" viewBox="0 0 800 ${120 + rows.length * 52}">
    <rect width="100%" height="100%" fill="#f9fafb"/>
    <rect width="100%" height="56" fill="#111827"/><text x="24" y="36" font-size="20" font-weight="700" font-family="Inter,Arial" fill="#fff">${title}</text>
    ${lines}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const NAMES = ['Ana Lopez  ·  (214) 555-2415', 'Ben Carter  ·  (469) 555-0199', 'Chris Wu  ·  (972) 555-7781'];

const ENTRIES = {
  entries: [
    {
      id: 'f089', date: '2026-11-20', type: 'feature', feature: 'F-089',
      title: 'Leads link to the car they asked about',
      summary: 'Each lead now shows the car with a link straight to its listing, so you can see what they want before you call.',
      links: { page: 'https://example.com/admin?tab=leads', commit: '486dd01', pr: 42 },
      shots: [{ label: 'Leads list', before: shot({ rows: NAMES }), after: shot({ rows: NAMES, extra: true }) }],
    },
    {
      id: 'search-row', date: '2026-11-20', type: 'improvement',
      title: 'List search sits on its own row',
      summary: 'Every admin list puts search at the top, above the filters, so it is easy to find on a phone.',
      links: { commit: 'd743286' },
      shots: [{ label: 'Inventory', after: shot({ rows: ['2019 Silverado 1500', '2017 Camry SE', '2020 RAV4 LE'], title: 'Inventory' }) }],
    },
    {
      id: 'deploy-del', date: '2026-11-18', type: 'fix',
      title: 'Deploy removes files that git deleted',
      summary: 'Old files no longer linger on the server after a deploy.',
      links: { commit: 'b8c3bd5', pr: 'https://github.com/example/app/pull/40' },
    },
    { id: 'bad', date: 'yesterday', type: 'feature', title: 'Dropped: no real date' },
  ],
};

export function ChangelogDemo() {
  const [state, setState] = useState('data');
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Panel title="Changelog" subtitle="Entries come from a committed changelog.json; screenshots from the ship step."
        actions={<Segmented label="State" value={state} onChange={setState}
          items={[{ value: 'data', label: 'Data' }, { value: 'loading', label: 'Loading' }, { value: 'empty', label: 'Empty' }, { value: 'error', label: 'Error' }]} />}>
        <Changelog
          entries={state === 'data' ? ENTRIES : []}
          repoUrl="https://github.com/example/app"
          loading={state === 'loading'}
          error={state === 'error' ? 'Couldn’t load changelog.json (404).' : null}
          onRetry={() => setState('data')}
        />
      </Panel>
      {state !== 'data' && <Button variant="secondary" size="sm" onClick={() => setState('data')}>Back to data</Button>}
    </div>
  );
}

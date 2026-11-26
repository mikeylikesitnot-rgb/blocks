import { useState } from 'react';
import { Changelog, CHANGE_TYPES, CompareImages, Panel, Segmented, Button, SearchInput, FilterMenu } from '../src/index.js';

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

/** A gallery that keeps Slider / Side by side and the line position from one image to the next. */
function RememberedCompare() {
  const pages = [{ title: 'Leads', rows: NAMES }, { title: 'Cars', rows: ['2021 F-150 XLT', '2019 Civic LX', '2018 Tahoe LT'] }];
  const [i, setI] = useState(0);
  const [view, setView] = useState({ mode: 'slider', pos: 50 });
  const p = pages[i];
  return (
    <Panel title="Compare gallery" subtitle="defaultMode/defaultPos + onModeChange/onPosChange: the view stays as you left it on the next image."
      actions={<Button size="sm" variant="secondary" onClick={() => setI((i + 1) % pages.length)}>Next image</Button>}>
      <CompareImages key={i} label={p.title} before={shot({ rows: p.rows, title: p.title })} after={shot({ rows: p.rows, title: p.title, extra: true })}
        defaultMode={view.mode} defaultPos={view.pos}
        onModeChange={(mode) => setView((v) => ({ ...v, mode }))} onPosChange={(pos) => setView((v) => ({ ...v, pos }))} />
    </Panel>
  );
}

export function ChangelogDemo() {
  const [state, setState] = useState('data');
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <RememberedCompare />
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
      <OwnFilters />
    </div>
  );
}

// toolbar={false}: the app draws its own filter row (search on its own line) and passes query/types in.
function OwnFilters() {
  const [query, setQuery] = useState('');
  const [types, setTypes] = useState([]);
  const options = Object.entries(CHANGE_TYPES).map(([value, t]) => ({ value, label: t.label }));
  return (
    <Panel title="toolbar={false}" subtitle="The app's own filter row: search on its own line, then the Type checklist and Reset filters.">
      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <SearchInput value={query} onChange={setQuery} placeholder="Search what's new" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <FilterMenu label="Type" allLabel="All types" options={options} value={types} onChange={setTypes} />
          {(query || types.length > 0) && <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setTypes([]); }}>Reset filters</Button>}
        </div>
      </div>
      <Changelog entries={ENTRIES} repoUrl="https://github.com/example/app" toolbar={false} query={query} types={types} />
    </Panel>
  );
}

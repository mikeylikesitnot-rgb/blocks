import { useMemo } from 'react';
import {
  SidebarLayout, NavMenu, InitialIcon, ThemeSwitch, FilterMenu, GroupedList, Badge, Button, EmptyState,
  SearchInput, Toolbar, StatCard, StatGrid, PageHeader, matchesQuery, useUrlState, useUrlList,
} from '../src/index.js';

const PROJECTS = [
  { slug: 'autodealer', name: 'AutoDealer', summary: 'NextGen Cars and Trucks website and admin console.' },
  { slug: 'blocks', name: 'Blocks', summary: 'Shared React UI and Express sign-in for every app.' },
  { slug: 'project-hub', name: 'Project Hub', summary: 'Every feature across all projects in one page.' },
  { slug: 'turo', name: 'TuroApp', summary: 'Trip, payout and expense tracking for the Turo fleet.' },
];
const F = (project, id, name, area, status, since, description, branch) => ({ project, id, name, area, status, since, description, branch });
const FEATURES = [
  F('autodealer', 'F-014', 'List filters', 'Admin', 'live', '2026-11-11', 'Checklist dropdowns and a price slider on every list, saved per account.'),
  F('autodealer', 'F-021', 'Payment calculator', 'Public site', 'progress', null, 'Monthly payment estimate on each vehicle page.', 'autodealer-payment-calc'),
  F('autodealer', 'F-022', 'Delinquency report', 'Financing', 'planned', null, 'Accounts 30, 60 and 90 days late, with a call list.'),
  F('blocks', 'F-002', 'Button system', 'Components', 'live', '2026-11-13', 'One Button with 7 variants, 4 sizes, icons, loading and link mode.'),
  F('blocks', 'F-011', 'Sidebar layout', 'Layout', 'progress', null, 'Sidebar that becomes a slide-out menu on phones.', 'hub-ui'),
  F('project-hub', 'F-004', 'Requests for any project', 'Requests', 'live', '2026-11-13', 'Add an idea for any project, then accept or drop it.'),
  F('project-hub', 'F-008', 'Sync all projects', 'Sync', 'live', '2026-11-13', 'Say "sync all" and every changed feature list updates.'),
  F('turo', 'F-006', 'Invoice import', 'Trips', 'planned', null, 'Read Turo invoice emails into trips automatically.'),
];
const STATUS = [
  { value: 'live', label: 'Live', tone: 'success' },
  { value: 'progress', label: 'In progress', tone: 'warning' },
  { value: 'planned', label: 'Planned', tone: 'accent' },
];

export function HubDemo() {
  const [project, setProject] = useUrlState('hp');
  const [q, setQ] = useUrlState('hq');
  const [status, setStatus] = useUrlList('hstatus');
  const [area, setArea] = useUrlList('harea');
  const reset = () => { setQ(''); setStatus([]); setArea([]); };

  const color = (slug) => PROJECTS.findIndex((p) => p.slug === slug);
  const inProject = FEATURES.filter((f) => !project || f.project === project);
  const areas = [...new Set(inProject.map((f) => f.area))].sort();
  const shown = inProject.filter((f) =>
    (!status.length || status.includes(f.status))
    && (!area.length || area.includes(f.area))
    && matchesQuery(q, [f.id, f.name, f.description, f.area, f.branch]));

  const groups = useMemo(() => PROJECTS.map((p) => {
    const items = shown.filter((f) => f.project === p.slug);
    return {
      key: p.slug, title: p.name, note: `${items.length} shown`,
      items: items.map((f) => {
        const st = STATUS.find((s) => s.value === f.status);
        return {
          key: `${f.project}-${f.id}`, id: f.id, title: f.name, description: f.description,
          badge: <Badge tone={st.tone}>{st.label}</Badge>,
          links: f.branch ? <span className="mk-tabular">⎇ {f.branch}</span> : null,
          aside: [f.area, f.since || ''],
        };
      }),
    };
  }), [shown]);

  const count = (s) => inProject.filter((f) => f.status === s).length;
  const current = PROJECTS.find((p) => p.slug === project);
  const nav = [
    { value: '', label: 'All projects', icon: <InitialIcon tone="ink">✱</InitialIcon>, count: FEATURES.length },
    { value: 'requests', label: 'Requests', keywords: 'ideas asks', icon: <InitialIcon tone="outline">R</InitialIcon>, count: 3, hot: true, note: '3 waiting for an answer', onClick: () => {} },
    { section: 'Projects', count: PROJECTS.length },
    ...PROJECTS.map((p, i) => {
      const building = FEATURES.filter((f) => f.project === p.slug && f.status === 'progress').length;
      return {
        value: p.slug, label: p.name, icon: <InitialIcon name={p.name} color={i} />,
        count: building ? `${building} building` : FEATURES.filter((f) => f.project === p.slug).length, hot: building > 0,
      };
    }),
  ];
  const filtered = q || status.length || area.length;

  return (
    <SidebarLayout
      brand="Project Hub"
      collapsible
      style={{ '--mk-shell-h': '760px' }}
      sidebar={<NavMenu prefKey="demo.hub.menu" label="Projects" items={nav} value={project} onChange={(v) => { setProject(v); setArea([]); }} />}
      footer={<ThemeSwitch />}
    >
      <div style={{ padding: '24px 16px 48px', display: 'grid', gap: 20, maxWidth: 1040 }}>
        <PageHeader
          title={current ? current.name : 'All projects'}
          subtitle={current ? current.summary : 'Every feature across your projects, with permanent IDs.'}
          meta={current ? <InitialIcon name={current.name} color={color(current.slug)} size="md" /> : null}
        />
        <StatGrid cols={3}>
          <StatCard label="Live" value={count('live')} />
          <StatCard label="In progress" value={count('progress')} />
          <StatCard label="Planned" value={count('planned')} />
        </StatGrid>
        <Toolbar right={`${shown.length} of ${inProject.length}`}>
          <div style={{ flex: '1 1 220px', minWidth: 0 }}><SearchInput value={q} onChange={setQ} placeholder="Search by ID or words" /></div>
          <FilterMenu label="Status" allLabel="All statuses" value={status} onChange={setStatus}
            options={STATUS.map((s) => ({ value: s.value, label: s.label, count: count(s.value) }))} />
          <FilterMenu label="Area" allLabel="All areas" value={area} onChange={setArea}
            options={areas.map((a) => ({ value: a, label: a }))} />
          {filtered ? <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button> : null}
        </Toolbar>
        <GroupedList
          label="Features"
          query={q}
          columns={['ID', 'Status', 'Feature', 'Area', 'Live since']}
          groups={groups}
          empty={<EmptyState variant="filtered" onClear={reset} />}
        />
      </div>
    </SidebarLayout>
  );
}

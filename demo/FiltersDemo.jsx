import {
  FilterMenu, RangeFilter, ColumnOrder, DataTable, SortTh, Panel, Toolbar, SearchInput, Button, Badge,
  useSavedFilters, useColumnOrder, useSort, useUrlState, listParam, rangeParam, inRange, rangeBounds, matchesQuery, money,
} from '../src/index.js';

const MAKES = ['Honda', 'Toyota', 'Ford', 'Chevrolet', 'Nissan'];
const CARS = Array.from({ length: 30 }, (_, i) => ({
  id: i + 1,
  make: MAKES[i % 5],
  model: ['Civic', 'Camry', 'F-150', 'Silverado', 'Altima', 'Accord'][i % 6],
  year: 2012 + (i % 11),
  miles: 30000 + ((i * 13771) % 150000),
  price: i % 9 === 0 ? 0 : 3500 + ((i * 2731) % 38000),
  status: ['Available', 'Pending', 'Sold'][i % 3],
  daily: i % 7 === 0 ? null : 35 + ((i * 17) % 80),
}));
const COLUMNS = [
  { key: 'make', label: 'Make', mobile: 'title', locked: true },
  { key: 'model', label: 'Model', mobile: 'subtitle' },
  { key: 'year', label: 'Year' },
  { key: 'miles', label: 'Miles', render: (v) => v.toLocaleString() },
  { key: 'price', label: 'Price', render: (v) => (v ? money(v) : null) },
  { key: 'status', label: 'Status', render: (v) => <Badge text={v} />, mobile: 'badge', hidden: true },
];

export function FiltersDemo() {
  const [q, setQ] = useUrlState('fq');
  const { filters, setFilters, resetFilters } = useSavedFilters('mk-demo.carFilters', ['make', 'minPrice', 'maxPrice', 'minDaily', 'maxDaily'], { linkKeys: ['fq'] });
  const make = listParam(filters.make);
  const price = rangeParam(filters, 'minPrice', 'maxPrice');
  const daily = rangeParam(filters, 'minDaily', 'maxDaily');
  const cols = useColumnOrder('mk-demo.carColumns', COLUMNS);

  const shown = CARS.filter((c) =>
    (!make.length || make.includes(c.make))
    && inRange(c.price || null, price)
    && inRange(c.daily, daily)
    && matchesQuery(q, [c.make, c.model, c.year]));
  const anyFilter = make.length || price[0] != null || price[1] != null || daily[0] != null || daily[1] != null || q;
  const reset = () => resetFilters({ fq: null });

  const small = useSort(CARS.slice(0, 5), { defaultSort: { key: 'price', dir: 'desc' } });

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Toolbar right={`${shown.length} of ${CARS.length} cars`}>
        <SearchInput value={q} onChange={setQ} placeholder="Make, model, year" />
        <FilterMenu label="Make" allLabel="All makes" value={make} onChange={(v) => setFilters({ make: v.join(',') || null })}
          options={MAKES.map((m) => ({ value: m, label: m, count: CARS.filter((c) => c.make === m).length }))} />
        <RangeFilter label="Price" allLabel="Any price" value={price} step={500}
          bounds={rangeBounds(CARS.map((c) => c.price), 500, price)}
          onChange={(min, max) => setFilters({ minPrice: min, maxPrice: max })} />
        <RangeFilter label="Avg $/day" allLabel="Any $/day" value={daily} step={5} unit="/day" format={(n) => `$${n}`}
          bounds={rangeBounds(CARS.map((c) => c.daily).filter((n) => n != null), 5, daily)}
          onChange={(min, max) => setFilters({ minDaily: min, maxDaily: max })} />
        <ColumnOrder {...cols.menu} />
        {anyFilter ? <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button> : null}
      </Toolbar>
      <DataTable label="Cars" columns={cols.columns} onReorder={cols.onReorder} data={shown}
        filtered={!!anyFilter} onClearFilters={reset} stickyHeader maxHeight="420px" />
      <p style={{ margin: 0, fontSize: 13, color: 'var(--mk-muted)' }}>
        Filters live in the URL and are saved in this browser: reload with a clean URL and they come back; open a link with
        ?make=Ford and it shows as is without overwriting your saved set. Cars with no price drop out once a price range is set.
      </p>

      <Panel title="SortTh" subtitle="A sortable header cell for a hand-built table." flush>
        <div className="mk-dt-scroll">
          <table className="mk-dt-table" aria-label="Top five">
            <thead>
              <tr>
                <SortTh col="model" sort={small}>Model</SortTh>
                <SortTh col="year" sort={small}>Year</SortTh>
                <SortTh col="price" sort={small} align="right">Price</SortTh>
              </tr>
            </thead>
            <tbody>
              {small.rows.map((c) => (
                <tr key={c.id}><td>{c.make} {c.model}</td><td>{c.year}</td><td className="mk-dt-right">{c.price ? money(c.price) : '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

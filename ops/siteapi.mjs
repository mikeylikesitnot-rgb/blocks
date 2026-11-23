#!/usr/bin/env node
// siteapi CLI: find a website's internal JSON API. See docs/decisions/siteapi.md.
//
//   node ops/siteapi.mjs capture <url> --site <name> [--chrome] [--headed] [--browse 120] [--port 9222]
//   node ops/siteapi.mjs analyze <site|har file> [--find "F-150"]... [--top 15] [--all-hosts]
//   node ops/siteapi.mjs probe <site> <n>            (or: probe <request.json>)
//
// Files go to ~/.config/siteapi/out/<site>/ (outside every repo: they hold cookies):
//   capture.har, endpoints.json (no header values), requests/<n>.json (full, local only), samples/<n>.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { analyzeHar, captureHar, probeRequest } from '../server/siteapi.js';

const OUT = join(homedir(), '.config', 'siteapi', 'out');
const [cmd, ...rest] = process.argv.slice(2);
const pos = [];
const opt = { find: [] };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) { pos.push(a); continue; }
  const k = a.slice(2);
  if (['chrome', 'headed', 'all-hosts'].includes(k)) opt[k] = true;
  else if (k === 'find') opt.find.push(rest[++i]);
  else opt[k] = rest[++i];
}
const die = (m) => { console.error(m); process.exit(1); };
const usage = () => die(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 10).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
const write = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2)); };

if (cmd === 'capture') {
  const [url] = pos;
  if (!url || !opt.site) usage();
  const har = await captureHar(url, {
    chrome: !!opt.chrome, headed: !!opt.headed || !!opt.browse, browseMs: Number(opt.browse || 0) * 1000,
    port: opt.port ? Number(opt.port) : undefined, log: (m) => console.error(m),
  });
  const file = join(OUT, opt.site, 'capture.har');
  write(file, har);
  console.log(`${har.log.entries.length} requests -> ${file}`);
} else if (cmd === 'analyze') {
  const [target] = pos;
  if (!target) usage();
  const file = existsSync(target) ? target : join(OUT, target, 'capture.har');
  if (!existsSync(file)) die(`No capture at ${file}. Run: capture <url> --site ${target}`);
  const dir = dirname(file);
  const r = analyzeHar(JSON.parse(readFileSync(file, 'utf8')), { find: opt.find, allHosts: !!opt['all-hosts'] });
  for (const e of r.endpoints) {
    write(join(dir, 'requests', `${e.n}.json`), e.request);
    write(join(dir, 'samples', `${e.n}.json`), e.sample ?? null);
  }
  write(join(dir, 'endpoints.json'), { pageHost: r.pageHost, embedded: r.embedded, endpoints: r.endpoints.map(({ request, sample, ...e }) => e) });
  console.log(`${r.endpoints.length} JSON endpoints (page: ${r.pageHost})\n`);
  for (const e of r.endpoints.slice(0, Number(opt.top || 15))) {
    const extra = [e.authHeaders.length && `auth: ${e.authHeaders.join(', ')}`, e.found.length && `FOUND: ${e.found.join(', ')}`].filter(Boolean).join('  ');
    console.log(`#${String(e.n).padEnd(3)} ${e.endpoint}\n     [${e.status}] x${e.calls}  ${e.bytes.toLocaleString()}B  list:${e.biggestList}  q:${e.queryKeys.join(',') || '-'}  ${extra}`);
  }
  if (r.embedded.length) {
    console.log('\nJSON embedded in HTML (fetch the page and parse that block):');
    for (const m of r.embedded) console.log(`  ${m.kind.padEnd(14)} ${m.chars.toLocaleString().padStart(9)} chars  ${m.url}${m.found.length ? `  FOUND: ${m.found.join(', ')}` : ''}`);
  }
  if (!r.endpoints.length && !r.embedded.length) console.log('No JSON found: the data is server-rendered HTML. Use the scrape fallback.');
  console.log(`\nDetails: ${join(dir, 'endpoints.json')}  (samples/<n>.json, requests/<n>.json)`);
} else if (cmd === 'probe') {
  const file = pos.length === 2 ? join(OUT, pos[0], 'requests', `${pos[1]}.json`) : pos[0];
  if (!file || !existsSync(file)) usage();
  const req = JSON.parse(readFileSync(file, 'utf8'));
  console.log(req.method, req.url.slice(0, 140));
  const r = await probeRequest(req);
  for (const l of r.levels) console.log(`  ${l.name.padEnd(16)} ${l.status} ${l.bytes.toLocaleString()}B ${l.json ? 'JSON' : `not JSON: ${l.preview}`}`);
  console.log(`\nMinimum that works: ${r.minimum || 'nothing (signed requests, a bot wall, or an expired session): use the scrape fallback'}`);
  if (r.minimum === 'full captured') console.log(`Narrow down: ${r.extraHeaders.join(', ')}`);
} else {
  usage();
}

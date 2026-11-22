/*
 * Self-update for unpacked Chrome/Edge extensions (`@mn/blocks/ext-update`).
 *
 * Chrome only auto-updates Web Store extensions. Ours are loaded unpacked from a folder
 * that ops/ext-update.sh keeps current (it copies a new release in when the manifest
 * version changes). This module, run from the extension's service worker, notices that
 * the manifest on disk is newer than the running one and reloads the extension
 * ('auto'), or shows a ↑ badge until applyExtUpdate() is called ('notify').
 *
 * Needs the service worker to be a module ("background": {"type": "module"}) and the
 * "alarms" permission for periodic checks (without it, it checks on each start only).
 * No React, no other imports besides ./version.js.
 */
import { compareVersions } from './version.js';

export const EXT_UPDATE_KEY = 'mnExtUpdate';
export const EXT_UPDATE_ALARM = 'mn-ext-update';

const api = (c) => c || globalThis.chrome;

/** The version in manifest.json on disk (unpacked extensions read files live). */
export async function diskVersion({ chrome: c, fetch: f = globalThis.fetch } = {}) {
  const res = await f(api(c).runtime.getURL('manifest.json'), { cache: 'no-store' });
  if (!res.ok) throw new Error(`manifest.json answered ${res.status}`);
  return (await res.json()).version;
}

async function setBadge(c, on) {
  try {
    await c.action?.setBadgeText({ text: on ? '↑' : '' });
    if (on) await c.action?.setBadgeBackgroundColor?.({ color: '#2563eb' });
    if (on) await c.action?.setTitle?.({ title: `${c.runtime.getManifest().name}: update ready, open to install` });
  } catch { /* no action button */ }
}

/**
 * One check. mode: 'auto' | 'notify' | 'off'.
 * Returns { current, onDisk, newer, action: 'reload' | 'notified' | 'none' }.
 */
export async function checkExtUpdate({ chrome: c, fetch: f, mode = 'auto' } = {}) {
  c = api(c);
  const current = c.runtime.getManifest().version;
  let onDisk = current;
  try { onDisk = await diskVersion({ chrome: c, fetch: f }); } catch { /* keep running version */ }
  const newer = compareVersions(onDisk, current) > 0;
  const stored = (await c.storage?.local.get(EXT_UPDATE_KEY))?.[EXT_UPDATE_KEY];
  if (!newer) {
    if (stored) { await c.storage.local.remove(EXT_UPDATE_KEY); await setBadge(c, false); }
    return { current, onDisk, newer, action: 'none' };
  }
  if (mode === 'auto') { c.runtime.reload(); return { current, onDisk, newer, action: 'reload' }; }
  if (mode === 'notify') {
    if (stored?.version !== onDisk) await c.storage?.local.set({ [EXT_UPDATE_KEY]: { version: onDisk, seenAt: Date.now() } });
    await setBadge(c, true);
    return { current, onDisk, newer, action: 'notified' };
  }
  return { current, onDisk, newer, action: 'none' };
}

/**
 * Call once at the top level of the service worker.
 * mode: a string or an (async) function returning one, e.g. read from chrome.storage.
 */
export function startExtUpdate({ chrome: c, fetch: f, mode = 'auto', intervalMinutes = 30 } = {}) {
  c = api(c);
  const run = async () => checkExtUpdate({ chrome: c, fetch: f, mode: typeof mode === 'function' ? await mode() : mode });
  if (c.alarms) {
    c.alarms.onAlarm.addListener((a) => { if (a.name === EXT_UPDATE_ALARM) run(); });
    c.alarms.get(EXT_UPDATE_ALARM).then((a) => { if (!a) c.alarms.create(EXT_UPDATE_ALARM, { periodInMinutes: intervalMinutes }); });
  }
  const first = run().catch(() => ({ action: 'none' }));
  return { check: run, first };
}

/** What a popup shows: { current, version } when an update is waiting, else null. */
export async function extUpdateStatus({ chrome: c } = {}) {
  c = api(c);
  const stored = (await c.storage?.local.get(EXT_UPDATE_KEY))?.[EXT_UPDATE_KEY];
  return stored ? { current: c.runtime.getManifest().version, version: stored.version } : null;
}

/** The popup's "Update now" button. */
export function applyExtUpdate({ chrome: c } = {}) {
  api(c).runtime.reload();
}

export { compareVersions };

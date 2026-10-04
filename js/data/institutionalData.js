// Reads the static data/institutional.json file that the scheduled GitHub
// Action (scripts/updateInstitutional.mjs) commits — this module NEVER
// calls the Google Drive API or TWSE directly from the browser. There is no
// key here and no rate-limit concern: it's a plain static-file fetch, same
// as any other asset the deployed site serves.
let cache = null;
let inflight = null;

/** `fresh: true` bypasses the browser's HTTP cache (and this module's own
 * memoized result) — used by holdings.view.js's 更新/全部更新 buttons so a
 * just-committed Action run is picked up without a full page reload. */
async function loadInstitutionalData({ fresh = false } = {}) {
  if (fresh) {
    cache = null;
    inflight = null;
  }
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetch('./data/institutional.json', { cache: fresh ? 'no-store' : 'default' });
      if (!res.ok) return {};
      cache = await res.json();
      return cache;
    } catch {
      return {};
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

async function getInstitutionalHistory(stockId, opts) {
  const all = await loadInstitutionalData(opts);
  return all[stockId] || [];
}

export { loadInstitutionalData, getInstitutionalHistory };

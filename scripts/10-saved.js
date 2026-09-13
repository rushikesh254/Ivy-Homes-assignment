/**
 * Step 10 - map the real saved-listings endpoint. Network.
 *
 * The documentation gives a Favourites section: GET/POST /v1/favourites and
 * DELETE /v1/favourites/{id}, with a {count, results} response. All of it 404s.
 * The real thing is at /v1/saved, which is in no part of the documentation.
 *
 * Part 1 requirement 4 is "Saved listings. Add, remove, list. Per user, and still
 * there after a reload and a re-login", so the exact contract matters: which
 * request field, which delete path, whether the response contains listing objects
 * or bare ids, and whether the store is really per user.
 *
 * Run: node scripts/10-saved.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { api, ROOT, j, stats, DEMO_PASSWORD } from './lib/http.js';
import { Session } from './lib/session.js';
import { loadAll } from './lib/data.js';

const { listings } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

const s1 = new Session({ email: 'demo1@ivy.homes' });
const s2 = new Session({ email: 'demo2@ivy.homes', password: DEMO_PASSWORD });
await s1.login();
await s2.login();

const A = listings[0].listing_id;
const B = listings[1].listing_id;
const C = listings[2].listing_id;

const show = (label, res) => {
  console.log(`  ${label.padEnd(52)} ${String(res.status).padStart(3)}  ${JSON.stringify(res.json).slice(0, 200)}`);
  return res;
};

// Start from a clean slate so the sequence below is reproducible.
async function clear(session) {
  const res = await session.get('/v1/saved', { label: 'saved:clear-list' });
  const rows = res.json?.results ?? [];
  for (const r of rows) {
    const id = typeof r === 'string' ? r : r.listing_id ?? r.id;
    await session.del(`/v1/saved/${id}`, { label: 'saved:clear-delete' });
  }
}
await clear(s1);
await clear(s2);

// ===========================================================================
hr('A. Which request field does POST /v1/saved accept?');
// ===========================================================================
{
  show('POST /v1/saved {"id": A}   (documented field name)', await s1.post('/v1/saved', { id: A }, { label: 'saved:post-id' }));
  const afterId = show('GET  /v1/saved', await s1.get('/v1/saved', { label: 'saved:get-after-id' }));

  show('POST /v1/saved {"listing_id": B}', await s1.post('/v1/saved', { listing_id: B }, { label: 'saved:post-listing_id' }));
  const afterBoth = show('GET  /v1/saved', await s1.get('/v1/saved', { label: 'saved:get-after-both' }));

  show('POST /v1/saved {} (empty body)', await s1.post('/v1/saved', {}, { label: 'saved:post-empty' }));
  show('POST /v1/saved {"id": "NOT-REAL"}', await s1.post('/v1/saved', { id: 'NOT-REAL' }, { label: 'saved:post-bad-id' }));
  show('POST /v1/saved {"id": A} again (duplicate)', await s1.post('/v1/saved', { id: A }, { label: 'saved:post-dup' }));
  const afterDup = show('GET  /v1/saved', await s1.get('/v1/saved', { label: 'saved:get-after-dup' }));

  out.post_field = {
    after_id_only: afterId.json,
    after_both: afterBoth.json,
    after_duplicate: afterDup.json,
  };
}

// ===========================================================================
hr('B. What does the collection actually contain?');
// ===========================================================================
{
  const res = await s1.get('/v1/saved', { label: 'saved:shape' });
  const body = res.json ?? {};
  console.log(`  documented for /v1/favourites: {"count": 3, "results": [ listing objects ]}`);
  console.log(`  actual top-level keys        : ${JSON.stringify(Object.keys(body))}`);
  const rows = body.results ?? [];
  console.log(`  results length              : ${rows.length}`);
  if (rows.length) {
    const first = rows[0];
    console.log(`  first entry type            : ${Array.isArray(first) ? 'array' : typeof first}`);
    if (typeof first === 'object') {
      console.log(`  first entry keys            : ${JSON.stringify(Object.keys(first))}`);
      console.log(`  is it a full listing object : ${'price' in first && 'carpet_area' in first && 'locality' in first}`);
      console.log(`  full first entry            : ${JSON.stringify(first).slice(0, 420)}`);
    } else {
      console.log(`  first entry value           : ${JSON.stringify(first)}`);
    }
  }
  out.shape = { keys: Object.keys(body), count: body.count ?? null, first: rows[0] ?? null };
}

// ===========================================================================
hr('C. Removing');
// ===========================================================================
{
  show(`DELETE /v1/saved/${A}`, await s1.del(`/v1/saved/${A}`, { label: 'saved:delete' }));
  show('GET  /v1/saved', await s1.get('/v1/saved', { label: 'saved:get-after-delete' }));
  show('DELETE the same id again', await s1.del(`/v1/saved/${A}`, { label: 'saved:delete-again' }));
  show('DELETE an id that was never saved', await s1.del(`/v1/saved/${C}`, { label: 'saved:delete-never' }));
  show('DELETE a nonexistent listing id', await s1.del('/v1/saved/NOT-REAL', { label: 'saved:delete-bad' }));
  sub('does the documented DELETE path work?');
  show(`DELETE /v1/favourites/${B}`, await s1.del(`/v1/favourites/${B}`, { label: 'saved:delete-documented-path' }));
}

// ===========================================================================
hr('D. Is the store per user, and does it outlast a re-login?');
// ===========================================================================
{
  await s1.post('/v1/saved', { id: A }, { label: 'saved:iso-1a' });
  await s1.post('/v1/saved', { id: B }, { label: 'saved:iso-1b' });
  await s2.post('/v1/saved', { id: C }, { label: 'saved:iso-2c' });

  const r1 = await s1.get('/v1/saved', { label: 'saved:iso-get1' });
  const r2 = await s2.get('/v1/saved', { label: 'saved:iso-get2' });
  const ids = (res) => (res.json?.results ?? []).map((r) => (typeof r === 'string' ? r : r.listing_id ?? r.id));
  console.log(`  demo1 saved: ${JSON.stringify(ids(r1))}`);
  console.log(`  demo2 saved: ${JSON.stringify(ids(r2))}`);
  console.log(`  isolated per user: ${JSON.stringify(ids(r1)) !== JSON.stringify(ids(r2))}`);

  sub('a brand new login for demo1 - is the store still there?');
  const s1b = new Session({ email: 'demo1@ivy.homes' });
  await s1b.login();
  const r1b = await s1b.get('/v1/saved', { label: 'saved:relogin' });
  console.log(`  demo1 after a fresh login: ${JSON.stringify(ids(r1b))}`);
  console.log(`  survives re-login: ${JSON.stringify(ids(r1b).sort()) === JSON.stringify(ids(r1).sort())}`);

  sub('without a bearer token?');
  show('GET /v1/saved with no token', await api('/v1/saved', { label: 'saved:no-token' }));
  sub('with a token but no api key?');
  show('GET /v1/saved with token, no X-API-Key', await api('/v1/saved', { keyMode: 'none', token: s1.accessToken, label: 'saved:no-key' }));

  out.isolation = { demo1: ids(r1), demo2: ids(r2), demo1_after_relogin: ids(r1b) };

  // Leave both accounts clean.
  await clear(s1b);
  await clear(s2);
  console.log(`\n  cleaned up: demo1 ${JSON.stringify((await s1b.get('/v1/saved', { label: 'saved:final1' })).json)}, demo2 ${JSON.stringify((await s2.get('/v1/saved', { label: 'saved:final2' })).json)}`);
}

console.log(`\nrequests this run: ${stats().requests}`);
const outPath = path.join(ROOT, 'notes', '10-saved.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`wrote ${path.relative(ROOT, outPath)}`);

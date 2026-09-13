/**
 * Step 8 - probe the rest of the documented surface. Network.
 *
 * Everything the documentation claims about filters, sorting, single-record
 * paths, similar listings and favourites, tested one claim at a time. Also
 * confirms the tail of the listings collection, which question 1 depends on.
 *
 * A filter is only "working" if every record it returns actually satisfies it.
 * A filter that is accepted, returns 200, and hands back violating records is
 * worse than one that errors, because nothing announces the failure.
 *
 * Run: node scripts/08-probe.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { api, ROOT, j, stats, DEMO_PASSWORD } from './lib/http.js';
import { Session } from './lib/session.js';
import { loadAll, tally } from './lib/data.js';

const { listings, rentals, projects } = loadAll();
const out = {};
const hr = (t) => console.log(`\n${'='.repeat(78)}\n${t}\n${'='.repeat(78)}`);
const sub = (t) => console.log(`\n--- ${t} ---`);

const session = new Session();
await session.login();

const recs = (res) => (Array.isArray(res.json?.results) ? res.json.results : []);
const env = (res) => {
  if (!res.json || Array.isArray(res.json)) return {};
  const { results, ...rest } = res.json;
  return rest;
};

// ===========================================================================
hr('A. The tail of /v1/listings - does 3800 really exhaust it?');
// ===========================================================================
{
  for (const offset of [3750, 3799, 3800, 3801, 4000]) {
    const res = await session.get('/v1/listings', { query: { limit: 50, offset }, label: `probe:tail-${offset}` });
    console.log(`  offset=${String(offset).padStart(5)} -> ${res.status}  ${JSON.stringify(env(res))}`);
    out.tail ??= {};
    out.tail[offset] = { status: res.status, ...env(res) };
  }
  sub('does the ceiling of 50 change the total retrievable count?');
  // Paging with a different limit must land on the same last record, or offset
  // paging is not consistent.
  const a = await session.get('/v1/listings', { query: { limit: 1, offset: 3799 }, label: 'probe:last-with-limit-1' });
  const b = await session.get('/v1/listings', { query: { limit: 50, offset: 3750 }, label: 'probe:last-with-limit-50' });
  console.log(`  limit=1  offset=3799 -> ${recs(a)[0]?.listing_id}  has_more=${a.json?.has_more}`);
  console.log(`  limit=50 offset=3750 -> last record ${recs(b).at(-1)?.listing_id}  has_more=${b.json?.has_more}`);
  console.log(`  same last record: ${recs(a)[0]?.listing_id === recs(b).at(-1)?.listing_id}`);
}

// ===========================================================================
hr('B. Filters on /v1/listings - documented and undocumented');
// ===========================================================================
{
  const local = (pred) => listings.filter(pred).length;
  const FILTERS = [
    // documented
    { name: 'locality=magarpatta', query: { locality: 'magarpatta' }, ok: (r) => r.locality === 'magarpatta', localCount: local((r) => r.locality === 'magarpatta'), documented: true },
    { name: 'locality=Magarpatta (capitalised)', query: { locality: 'Magarpatta' }, ok: (r) => r.locality === 'magarpatta', localCount: null, documented: true },
    { name: 'bhk=2', query: { bhk: 2 }, ok: (r) => r.bedroom === 2, localCount: local((r) => r.bedroom === 2), documented: true },
    { name: 'property_type=villa', query: { property_type: 'villa' }, ok: (r) => r.property_type === 'villa', localCount: local((r) => r.property_type === 'villa'), documented: true },
    { name: 'min_price=20000000', query: { min_price: 20000000 }, ok: (r) => r.price >= 20000000, localCount: local((r) => r.price >= 20000000), documented: true },
    { name: 'max_price=5000000', query: { max_price: 5000000 }, ok: (r) => r.price <= 5000000, localCount: local((r) => r.price <= 5000000), documented: true },
    { name: 'furnishing=fully-furnished', query: { furnishing: 'fully-furnished' }, ok: (r) => r.furnishing === 'fully-furnished', localCount: local((r) => r.furnishing === 'fully-furnished'), documented: true },
    { name: 'min_price+max_price band', query: { min_price: 8000000, max_price: 9000000 }, ok: (r) => r.price >= 8000000 && r.price <= 9000000, localCount: local((r) => r.price >= 8000000 && r.price <= 9000000), documented: true },
    { name: 'locality+bhk together', query: { locality: 'baner', bhk: 3 }, ok: (r) => r.locality === 'baner' && r.bedroom === 3, localCount: local((r) => r.locality === 'baner' && r.bedroom === 3), documented: true },
    // used in the docs' prose but never listed as a parameter
    { name: 'project_id=P30001', query: { project_id: 'P30001' }, ok: (r) => r.project_id === 'P30001', localCount: local((r) => r.project_id === 'P30001'), documented: 'prose only' },
    // plausible but undocumented
    { name: 'is_live=true', query: { is_live: true }, ok: (r) => r.is_live === true, localCount: local((r) => r.is_live === true), documented: false },
    { name: 'website=dwelling', query: { website: 'dwelling' }, ok: (r) => r.website === 'dwelling', localCount: local((r) => r.website === 'dwelling'), documented: false },
    { name: 'bedroom=2 (instead of bhk)', query: { bedroom: 2 }, ok: (r) => r.bedroom === 2, localCount: local((r) => r.bedroom === 2), documented: false },
    // nonsense, to see whether unknown parameters are rejected or ignored
    { name: 'not_a_real_param=xyz', query: { not_a_real_param: 'xyz' }, ok: () => true, localCount: listings.length, documented: false },
    { name: 'locality=nonexistent', query: { locality: 'zzz-nowhere' }, ok: (r) => false, localCount: 0, documented: true },
  ];

  out.filters = [];
  for (const f of FILTERS) {
    const res = await session.get('/v1/listings', { query: { ...f.query, limit: 50 }, label: `probe:filter:${f.name}` });
    const rows = recs(res);
    const violating = rows.filter((r) => !f.ok(r));
    const e = env(res);
    const verdict = res.status !== 200
      ? `HTTP ${res.status} ${JSON.stringify(res.json)}`
      : rows.length === 0
        ? 'returned nothing'
        : violating.length === 0
          ? 'filters correctly'
          : `*** IGNORED: ${violating.length}/${rows.length} returned records violate it ***`;
    console.log(
      `  ${f.name.padEnd(34)} ${String(res.status).padStart(3)}  returned=${String(rows.length).padStart(3)}  ` +
      `total=${String(e.total ?? '-').padStart(5)}  snapshot=${String(f.localCount ?? '-').padStart(5)}  ${verdict}`,
    );
    out.filters.push({ ...f, ok: undefined, status: res.status, returned: rows.length, total: e.total ?? null, violating: violating.length, verdict, sample_violations: violating.slice(0, 3).map((r) => r.listing_id) });
  }
}

// ===========================================================================
hr('C. Sorting');
// ===========================================================================
{
  const monotone = (xs, dir) => xs.every((v, i) => i === 0 || (dir === 'asc' ? xs[i - 1] <= v : xs[i - 1] >= v));
  const FIELD = { price: 'price', carpet_area: 'carpet_area', posted_at: 'posted_at', bedroom: 'bedroom' };
  out.sorting = [];
  for (const sortBy of Object.keys(FIELD)) {
    for (const order of ['asc', 'desc']) {
      const res = await session.get('/v1/listings', { query: { sort_by: sortBy, order, limit: 50 }, label: `probe:sort:${sortBy}:${order}` });
      const rows = recs(res);
      const vals = rows.map((r) => r[FIELD[sortBy]]);
      const asc = monotone(vals, 'asc');
      const desc = monotone(vals, 'desc');
      const verdict = res.status !== 200
        ? `HTTP ${res.status}`
        : asc && desc
          ? 'all values equal - inconclusive'
          : (order === 'asc' && asc) || (order === 'desc' && desc)
            ? 'sorts as asked'
            : asc
              ? `*** sorted ASC despite order=${order} ***`
              : desc
                ? `*** sorted DESC despite order=${order} ***`
                : '*** not sorted at all ***';
      console.log(`  sort_by=${sortBy.padEnd(12)} order=${order.padEnd(5)} ${String(res.status).padStart(3)}  first=${String(vals[0]).slice(0, 20).padEnd(21)} last=${String(vals.at(-1)).slice(0, 20).padEnd(21)} ${verdict}`);
      out.sorting.push({ sortBy, order, status: res.status, verdict, first: vals[0] ?? null, last: vals.at(-1) ?? null });
    }
  }
  sub('an undocumented sort field, to see whether unknown values are rejected');
  for (const sortBy of ['deposit', 'nonsense_field']) {
    const res = await session.get('/v1/listings', { query: { sort_by: sortBy, limit: 5 }, label: `probe:sort:${sortBy}` });
    console.log(`  sort_by=${sortBy.padEnd(16)} -> ${res.status} ${JSON.stringify(res.json?.detail ?? recs(res).map((r) => r.listing_id).slice(0, 3))}`);
  }
}

// ===========================================================================
hr('D. Single-record paths');
// ===========================================================================
{
  const lid = listings[0].listing_id;
  const rid = rentals[0].listing_id;
  const pid = projects[0].project_id;
  const PATHS = [
    { path: `/v1/listing/${lid}`, documented: 'yes - GET /v1/listing/{listing_id}' },
    { path: `/v1/listings/${lid}`, documented: 'no' },
    { path: `/v1/rentals/${rid}`, documented: 'yes - GET /v1/rentals/{listing_id}' },
    { path: `/v1/rental/${rid}`, documented: 'no' },
    { path: `/v1/projects/${pid}`, documented: 'yes - GET /v1/projects/{project_id}' },
    { path: `/v1/project/${pid}`, documented: 'no' },
    { path: `/v1/listings/${lid}/similar`, documented: 'yes - up to ten comparable listings' },
    { path: `/v1/listing/${lid}/similar`, documented: 'no' },
    { path: '/v1/listings/NOT-A-REAL-ID', documented: 'n/a - expect 404' },
    { path: '/v1/analytics/summary', documented: 'yes - full schema given' },
    { path: '/v1/analytics', documented: 'no' },
  ];
  out.paths = [];
  for (const p of PATHS) {
    const res = await session.get(p.path, { label: `probe:path:${p.path}` });
    const body = res.json;
    let shape = '';
    if (res.ok && body) {
      if (Array.isArray(body)) shape = `array[${body.length}]`;
      else if (Array.isArray(body.results)) shape = `envelope, results[${body.results.length}]`;
      else shape = `object keys: ${Object.keys(body).slice(0, 6).join(',')}${Object.keys(body).length > 6 ? ',...' : ''}`;
    } else {
      shape = JSON.stringify(body);
    }
    console.log(`  ${p.path.padEnd(40)} ${String(res.status).padStart(3)}  documented=${String(p.documented).padEnd(38)} ${shape}`);
    out.paths.push({ path: p.path, documented: p.documented, status: res.status, shape });
  }

  sub('if /similar exists, does it honour its documented contract?');
  const target = listings.find((r) => r.bedroom === 3 && r.price > 0);
  for (const candidate of [`/v1/listings/${target.listing_id}/similar`, `/v1/listing/${target.listing_id}/similar`]) {
    const res = await session.get(candidate, { label: `probe:similar:${candidate}` });
    if (!res.ok) { console.log(`  ${candidate} -> ${res.status}`); continue; }
    const rows = Array.isArray(res.json) ? res.json : recs(res);
    console.log(`  ${candidate} -> ${rows.length} records`);
    console.log(`    target: locality=${target.locality} bedroom=${target.bedroom} price=${target.price}`);
    console.log(`    documented: same locality, same bedroom count, price within 15%, at most ten`);
    const wrongLoc = rows.filter((r) => r.locality !== target.locality).length;
    const wrongBhk = rows.filter((r) => r.bedroom !== target.bedroom).length;
    const wrongPrice = rows.filter((r) => Math.abs(r.price - target.price) / target.price > 0.15).length;
    console.log(`    different locality: ${wrongLoc}/${rows.length}   different bedroom: ${wrongBhk}/${rows.length}   price outside 15%: ${wrongPrice}/${rows.length}`);
    console.log(`    includes the target itself: ${rows.some((r) => r.listing_id === target.listing_id)}`);
    out.similar = { path: candidate, count: rows.length, wrongLoc, wrongBhk, wrongPrice, includesSelf: rows.some((r) => r.listing_id === target.listing_id) };
  }
}

// ===========================================================================
hr('E. Favourites');
// ===========================================================================
{
  const id1 = listings[0].listing_id;
  const id2 = listings[1].listing_id;

  const show = (label, res) => {
    console.log(`  ${label.padEnd(46)} ${String(res.status).padStart(3)}  ${JSON.stringify(res.json).slice(0, 160)}`);
    return res;
  };

  const before = show('GET /v1/favourites (demo1, initial)', await session.get('/v1/favourites', { label: 'probe:fav:get' }));

  // The documented body is {"id": "..."}. Try that, then the plausible
  // alternative, to find out which the server actually accepts.
  show('POST /v1/favourites {"id":...}  (documented)', await session.post('/v1/favourites', { id: id1 }, { label: 'probe:fav:post-id' }));
  show('POST /v1/favourites {"listing_id":...}', await session.post('/v1/favourites', { listing_id: id2 }, { label: 'probe:fav:post-listing_id' }));
  const after = show('GET /v1/favourites (demo1, after)', await session.get('/v1/favourites', { label: 'probe:fav:get2' }));

  sub('what does the collection actually look like?');
  console.log(`  documented: {"count": 3, "results": [ listing objects ]}`);
  console.log(`  actual keys: ${JSON.stringify(Object.keys(after.json ?? {}))}`);
  const favRows = Array.isArray(after.json?.results) ? after.json.results : Array.isArray(after.json) ? after.json : [];
  if (favRows.length) {
    console.log(`  first entry is ${typeof favRows[0] === 'object' ? `an object with keys: ${Object.keys(favRows[0]).slice(0, 8).join(',')}` : `a ${typeof favRows[0]}: ${favRows[0]}`}`);
    console.log(`  full listing object? ${typeof favRows[0] === 'object' && 'price' in favRows[0] && 'carpet_area' in favRows[0]}`);
  }

  sub('per-user isolation - does demo2 see demo1\'s favourites?');
  const s2 = new Session({ email: 'demo2@ivy.homes', password: DEMO_PASSWORD });
  await s2.login();
  const d2 = show('GET /v1/favourites (demo2)', await s2.get('/v1/favourites', { label: 'probe:fav:get-demo2' }));
  const d2Rows = Array.isArray(d2.json?.results) ? d2.json.results : [];
  console.log(`  demo1 count=${favRows.length}  demo2 count=${d2Rows.length}  isolated=${JSON.stringify(favRows.map((r) => r.listing_id ?? r)) !== JSON.stringify(d2Rows.map((r) => r.listing_id ?? r))}`);

  sub('survives a fresh login? (favourites must outlast a re-login)');
  const s1b = new Session();
  await s1b.login();
  const again = show('GET /v1/favourites (demo1, new session)', await s1b.get('/v1/favourites', { label: 'probe:fav:get-relogin' }));
  const againRows = Array.isArray(again.json?.results) ? again.json.results : [];
  console.log(`  same contents after re-login: ${againRows.length === favRows.length}`);

  sub('deleting');
  show(`DELETE /v1/favourites/${id1}`, await session.del(`/v1/favourites/${id1}`, { label: 'probe:fav:delete' }));
  show('GET /v1/favourites (after delete)', await session.get('/v1/favourites', { label: 'probe:fav:get3' }));
  show('DELETE a favourite that is not saved', await session.del('/v1/favourites/NOT-A-REAL-ID', { label: 'probe:fav:delete-missing' }));
  show('POST the same listing twice', await session.post('/v1/favourites', { id: id2 }, { label: 'probe:fav:post-dup' }));
  show('POST a listing id that does not exist', await session.post('/v1/favourites', { id: 'NOT-A-REAL-ID' }, { label: 'probe:fav:post-bad' }));
  show('GET /v1/favourites without a token', await api('/v1/favourites', { label: 'probe:fav:no-token' }));

  // Leave the account clean.
  await session.del(`/v1/favourites/${id2}`, { label: 'probe:fav:cleanup' });

  out.favourites = {
    initial: before.json,
    after_two_posts: after.json,
    demo2: d2.json,
    keys: Object.keys(after.json ?? {}),
  };
}

// ===========================================================================
hr('F. Auth odds and ends');
// ===========================================================================
{
  const bad = await api('/v1/listings', { query: { limit: 1 }, token: 'not-a-real-token', label: 'probe:auth:bad-token' });
  console.log(`  bearer token that is nonsense        -> ${bad.status} ${JSON.stringify(bad.json)}`);

  const wrongPw = await api('/auth/login', { method: 'POST', body: { email: 'demo1@ivy.homes', password: 'wrong' }, label: 'probe:auth:wrong-password' });
  console.log(`  login with the wrong password        -> ${wrongPw.status} ${JSON.stringify(wrongPw.json)}`);

  const unknownUser = await api('/auth/login', { method: 'POST', body: { email: 'nobody@ivy.homes', password: DEMO_PASSWORD }, label: 'probe:auth:unknown-user' });
  console.log(`  login as an unknown user             -> ${unknownUser.status} ${JSON.stringify(unknownUser.json)}`);

  const s3 = new Session({ email: 'demo3@ivy.homes', password: DEMO_PASSWORD });
  await s3.login();
  console.log(`  demo3 logs in                        -> ok, expires_in=${s3.loginBody.expires_in}`);

  const logout = await s3.post('/auth/logout', {}, { label: 'probe:auth:logout' });
  console.log(`  POST /auth/logout                    -> ${logout.status} ${JSON.stringify(logout.json)}`);
  const afterLogout = await api('/v1/listings', { query: { limit: 1 }, token: s3.accessToken, label: 'probe:auth:after-logout' });
  console.log(`  the token after logout               -> ${afterLogout.status} ${JSON.stringify(afterLogout.json?.detail ?? 'still works')}`);

  const refreshTwice = await api('/auth/refresh', { method: 'POST', body: { refresh_token: 'nonsense' }, label: 'probe:auth:bad-refresh' });
  console.log(`  refresh with a nonsense token        -> ${refreshTwice.status} ${JSON.stringify(refreshTwice.json)}`);

  out.auth_extras = {
    bad_token: { status: bad.status, body: bad.json },
    wrong_password: { status: wrongPw.status, body: wrongPw.json },
    unknown_user: { status: unknownUser.status, body: unknownUser.json },
    logout: { status: logout.status, body: logout.json },
    token_after_logout: { status: afterLogout.status, body: afterLogout.json },
    bad_refresh: { status: refreshTwice.status, body: refreshTwice.json },
  };
}

// ===========================================================================
hr('G. Filters on rentals and projects');
// ===========================================================================
{
  const checks = [
    { path: '/v1/rentals', query: { locality: 'magarpatta' }, ok: (r) => r.locality === 'magarpatta', local: rentals.filter((r) => r.locality === 'magarpatta').length },
    { path: '/v1/rentals', query: { bhk: 3 }, ok: (r) => r.bedroom === 3, local: rentals.filter((r) => r.bedroom === 3).length },
    { path: '/v1/rentals', query: { furnishing: 'unfurnished' }, ok: (r) => r.furnishing === 'unfurnished', local: rentals.filter((r) => r.furnishing === 'unfurnished').length },
    { path: '/v1/rentals', query: { min_price: 50000 }, ok: (r) => r.price >= 50000, local: rentals.filter((r) => r.price >= 50000).length },
    { path: '/v1/projects', query: { locality: 'kharadi' }, ok: (r) => r.locality === 'kharadi', local: projects.filter((r) => r.locality === 'kharadi').length },
    { path: '/v1/projects', query: { project_status: 'ready to move' }, ok: (r) => r.project_status === 'ready to move', local: projects.filter((r) => r.project_status === 'ready to move').length },
  ];
  out.other_filters = [];
  for (const c of checks) {
    const res = await session.get(c.path, { query: { ...c.query, limit: 50 }, label: `probe:filter:${c.path}:${JSON.stringify(c.query)}` });
    const rows = recs(res);
    const bad = rows.filter((r) => !c.ok(r));
    const verdict = res.status !== 200 ? `HTTP ${res.status}` : bad.length === 0 ? 'filters correctly' : `*** IGNORED: ${bad.length}/${rows.length} violate ***`;
    console.log(`  ${c.path} ${JSON.stringify(c.query).padEnd(36)} ${String(res.status).padStart(3)} returned=${String(rows.length).padStart(3)} total=${String(env(res).total ?? '-').padStart(5)} snapshot=${String(c.local).padStart(5)}  ${verdict}`);
    out.other_filters.push({ ...c, ok: undefined, status: res.status, returned: rows.length, total: env(res).total ?? null, violating: bad.length, verdict });
  }
  sub('sorting on projects');
  for (const sortBy of ['price_min', 'price_max', 'launch_date', 'total_units']) {
    const res = await session.get('/v1/projects', { query: { sort_by: sortBy, order: 'desc', limit: 10 }, label: `probe:sort:projects:${sortBy}` });
    const vals = recs(res).map((r) => r[sortBy]);
    const desc = vals.every((v, i) => i === 0 || vals[i - 1] >= v);
    console.log(`  sort_by=${sortBy.padEnd(12)} order=desc -> ${res.status}  ${JSON.stringify(vals.slice(0, 6))}  monotone-desc=${desc}`);
  }
}

console.log(`\nrequests this run: ${stats().requests}`);
const outPath = path.join(ROOT, 'notes', '08-probe.json');
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`wrote ${path.relative(ROOT, outPath)}`);

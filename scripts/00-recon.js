/**
 * Step 0 - recon. Roughly twenty requests, before any bulk download.
 *
 * The point is to answer the questions that would silently corrupt every later
 * number if I guessed them wrong, rather than to find findings for their own
 * sake:
 *
 *   1. How is a request actually authenticated? (docs: ?api_key= query param)
 *   2. How long does a session really live? (docs: 86400s, no refresh flow)
 *   3. What does a collection response actually look like, and which parameter
 *      really moves the window? API_REFERENCE.md says `page` + `limit` with
 *      {total, page, page_size, results}. statement.md says every page reports
 *      "which limit and offset it used ... and whether more remain". Those are
 *      two different APIs. If `page` is accepted and ignored, a naive pager
 *      re-downloads page 1 forever and reports a confident wrong total.
 *   4. What are the real field names on a record? (Q3 asks about `is_live`,
 *      which appears nowhere in the documentation.)
 *   5. What do errors look like? The docs claim they are written to be useful.
 *      If that is true they are a free map of the real parameter names.
 *
 * Run: node scripts/00-recon.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { api, decodeJwt, j, keysOf, BASE_URL, API_KEY, ROOT, stats } from './lib/http.js';
import { Session } from './lib/session.js';

const out = {};
const hr = (title) => console.log(`\n${'='.repeat(74)}\n${title}\n${'='.repeat(74)}`);

/** Print a collection envelope without drowning in the results array. */
function envelope(res) {
  if (!res.json || typeof res.json !== 'object') return { non_json: res.text?.slice(0, 300) };
  if (Array.isArray(res.json)) return { TOP_LEVEL_IS_ARRAY: true, length: res.json.length };
  const shell = {};
  for (const [k, v] of Object.entries(res.json)) {
    shell[k] = Array.isArray(v) ? `<array len=${v.length}>` : v;
  }
  return shell;
}

/** Find the array of records inside an envelope, whatever it is called. */
function recordsOf(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const v of Object.values(json)) if (Array.isArray(v)) return v;
  return [];
}

const idOf = (res) => {
  const r = recordsOf(res.json)[0];
  if (!r) return null;
  return r.listing_id ?? r.id ?? r.project_id ?? JSON.stringify(r).slice(0, 60);
};

const brief = (res) => j(res.json ?? res.text?.slice(0, 200));

console.log(`base url : ${BASE_URL}`);
console.log(`api key  : ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)} (len ${API_KEY.length})`);

// ---------------------------------------------------------------------------
hr('1. GET /health  (unauthenticated)');
{
  const localNow = new Date();
  const res = await api('/health', { keyMode: 'none', label: 'recon:health' });
  console.log(`status ${res.status}`);
  console.log(j(res.json ?? res.text));
  console.log(`\nlocal clock at time of call: ${localNow.toISOString()}`);
  out.health = { status: res.status, body: res.json, local_iso: localNow.toISOString() };
}

// ---------------------------------------------------------------------------
hr('2. Key transport: header vs query parameter');
{
  const noKey = await api('/v1/listings', { query: { limit: 1 }, keyMode: 'none', label: 'recon:err-no-key' });
  console.log(`no key at all       -> ${noKey.status}  ${brief(noKey)}`);

  // AUTH-1 regression probe: this is exactly what API_REFERENCE.md documents.
  const keyInQuery = await api('/v1/listings', { query: { limit: 1 }, keyMode: 'query', label: 'recon:key-in-query' });
  console.log(`key as ?api_key=    -> ${keyInQuery.status}  ${brief(keyInQuery)}`);

  const badKey = await api('/v1/listings', {
    query: { limit: 1 },
    keyMode: 'none',
    headers: { 'X-API-Key': 'IVY26-000000000000' },
    label: 'recon:err-bad-key',
  });
  console.log(`bogus key in header -> ${badKey.status}  ${brief(badKey)}`);

  const keyOnly = await api('/v1/listings', { query: { limit: 1 }, label: 'recon:key-but-no-token' });
  console.log(`valid key, no token -> ${keyOnly.status}  ${brief(keyOnly)}`);

  out.key_transport = {
    no_key: { status: noKey.status, body: noKey.json },
    key_in_query: { status: keyInQuery.status, body: keyInQuery.json },
    bad_key: { status: badKey.status, body: badKey.json },
    key_without_token: { status: keyOnly.status, body: keyOnly.json },
  };
}

// ---------------------------------------------------------------------------
hr('3. POST /auth/login -> real response shape and real token lifetime');
const session = new Session({ verbose: true });
{
  const body = await session.login();

  const shown = { ...body };
  for (const k of ['access_token', 'token', 'refresh_token']) {
    if (shown[k]) shown[k] = `${String(shown[k]).slice(0, 16)}...(len ${String(shown[k]).length})`;
  }
  console.log(j(shown));

  const accessClaims = decodeJwt(body.access_token ?? body.token);
  const refreshClaims = decodeJwt(body.refresh_token);
  console.log('\naccess token claims :', j(accessClaims));
  console.log('refresh token claims:', j(refreshClaims));
  if (accessClaims?.exp && accessClaims?.iat) {
    console.log(`\naccess  exp-iat = ${accessClaims.exp - accessClaims.iat}s (${((accessClaims.exp - accessClaims.iat) / 60).toFixed(0)} min)`);
  }
  if (refreshClaims?.exp && refreshClaims?.iat) {
    console.log(`refresh exp-iat = ${refreshClaims.exp - refreshClaims.iat}s (${((refreshClaims.exp - refreshClaims.iat) / 86400).toFixed(1)} days)`);
  }
  console.log(`\ndocumented: token="token", expires_in=86400, "There is no refresh flow."`);

  out.login = {
    body_keys: keysOf(body),
    expires_in: body.expires_in ?? null,
    token_type: body.token_type ?? null,
    refresh_url: body.refresh_url ?? null,
    user: body.user ?? null,
    access_claims: accessClaims,
    refresh_claims: refreshClaims,
  };
}

// ---------------------------------------------------------------------------
hr('4. Does the undocumented /auth/refresh work?');
{
  const before = session.accessToken;
  await session.refresh();
  const changed = session.accessToken !== before;
  console.log(`refresh calls that succeeded: ${session.refreshCount}`);
  console.log(`access token changed: ${changed}`);
  console.log(`new token good for: ${session.expiresInS}s`);
  out.refresh = { succeeded: session.refreshCount > 0, token_changed: changed, expires_in_s: session.expiresInS };
}

// ---------------------------------------------------------------------------
hr('5. GET /v1/listings?limit=1 -> real envelope + real field names');
{
  const res = await session.get('/v1/listings', { query: { limit: 1 }, label: 'recon:listings-limit1' });
  console.log(`status ${res.status}`);
  console.log('\n-- envelope (arrays collapsed) --');
  console.log(j(envelope(res)));

  const recs = recordsOf(res.json);
  console.log(`\n-- records returned: ${recs.length} --`);
  if (recs[0]) {
    console.log('\n-- field names on record[0] --');
    console.log(j(keysOf(recs[0])));
    console.log('\n-- record[0] in full --');
    console.log(j(recs[0]));
  }
  console.log('\n-- response headers --');
  console.log(j(res.headers));

  out.listings_limit1 = {
    status: res.status,
    envelope: envelope(res),
    record_keys: keysOf(recs[0]),
    first_record: recs[0] ?? null,
    headers: res.headers,
  };
}

// ---------------------------------------------------------------------------
hr('6. GET /v1/listings with no params -> real default limit');
{
  const res = await session.get('/v1/listings', { label: 'recon:listings-defaults' });
  const recs = recordsOf(res.json);
  console.log(`status ${res.status}, records returned: ${recs.length}  (docs claim default limit 20)`);
  console.log(j(envelope(res)));
  out.listings_defaults = { status: res.status, returned: recs.length, envelope: envelope(res) };
}

// ---------------------------------------------------------------------------
hr('7. Pagination: does `page` move the window, or only `offset`?');
{
  const base = await session.get('/v1/listings', { query: { limit: 1 }, label: 'recon:page-baseline' });
  const byPage = await session.get('/v1/listings', { query: { limit: 1, page: 2 }, label: 'recon:page-2' });
  const byOffset = await session.get('/v1/listings', { query: { limit: 1, offset: 1 }, label: 'recon:offset-1' });

  const a = idOf(base);
  const b = idOf(byPage);
  const c = idOf(byOffset);

  console.log(`limit=1          -> ${a}`);
  console.log(`limit=1&page=2   -> ${b}   ${b === a ? '*** SAME as baseline: `page` is accepted and IGNORED ***' : '(page moved the window)'}`);
  console.log(`limit=1&offset=1 -> ${c}   ${c === a ? '(offset did NOT move the window)' : '*** offset moved the window ***'}`);
  console.log('\nbaseline envelope :', j(envelope(base)));
  console.log('page=2 envelope   :', j(envelope(byPage)));
  console.log('offset=1 envelope :', j(envelope(byOffset)));

  out.pagination_probe = {
    baseline_id: a,
    page2_id: b,
    offset1_id: c,
    page_param_ignored: b === a,
    offset_param_works: c !== null && c !== a,
    envelopes: { base: envelope(base), page2: envelope(byPage), offset1: envelope(byOffset) },
  };
}

// ---------------------------------------------------------------------------
hr('8. Limit ceiling: what does the server actually allow?');
{
  for (const limit of [200, 201, 500, 99999, 0, -1]) {
    const res = await session.get('/v1/listings', { query: { limit }, label: `recon:limit-${limit}` });
    const recs = recordsOf(res.json);
    const echoed = res.json && !Array.isArray(res.json)
      ? Object.fromEntries(Object.entries(res.json).filter(([k]) => !Array.isArray(res.json[k])))
      : {};
    console.log(`limit=${String(limit).padEnd(6)} -> ${res.status}  returned=${String(recs.length).padEnd(4)} echoed=${JSON.stringify(echoed)}`);
    out.limit_probe ??= {};
    out.limit_probe[limit] = { status: res.status, returned: recs.length, echoed, detail: res.json?.detail ?? null };
  }
}

// ---------------------------------------------------------------------------
hr('9. Quick peek at the other collections');
{
  for (const p of ['/v1/rentals', '/v1/projects']) {
    const res = await session.get(p, { query: { limit: 1 }, label: `recon:peek${p}` });
    const recs = recordsOf(res.json);
    console.log(`\n${p} -> ${res.status}`);
    console.log('envelope   :', j(envelope(res)));
    console.log('field names:', j(keysOf(recs[0])));
    if (recs[0]) console.log('record[0]  :', j(recs[0]));
    out.peek ??= {};
    out.peek[p] = { status: res.status, envelope: envelope(res), record_keys: keysOf(recs[0]), first_record: recs[0] ?? null };
  }

  const an = await session.get('/v1/analytics/summary', { label: 'recon:analytics' });
  console.log(`\n/v1/analytics/summary -> ${an.status}`);
  console.log(j(an.json ?? an.text?.slice(0, 400)));
  out.peek['/v1/analytics/summary'] = { status: an.status, body: an.json };
}

// ---------------------------------------------------------------------------
hr('summary');
console.log(`total requests made: ${stats().requests}`);
const outPath = path.join(ROOT, 'notes', '00-recon.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, j(out), 'utf8');
console.log(`wrote ${path.relative(ROOT, outPath)}`);

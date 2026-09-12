/**
 * Exhaustive pager, with self-checks.
 *
 * Recon established (see notes/findings-log.md):
 *   PAG-1  paging is `offset`, not `page`; `page` is accepted and ignored
 *   PAG-2  envelope is {limit, offset, count, total, has_more, results}
 *   PAG-3  the limit ceiling is 50, silently clamped, not the documented 200
 *
 * The documented recipe - read `total`, divide by `limit`, request that many
 * pages - fails silently in two independent ways here. So this pager refuses to
 * trust anything it can verify instead:
 *
 *   - it terminates on `has_more`, never on a computed page count;
 *   - it reads the *echoed* `limit` rather than assuming the requested one held;
 *   - it asserts the window actually moved, by comparing each page's record set
 *     to the previous page's. Two identical consecutive pages is the signature
 *     of ignored paging, and it aborts rather than looping;
 *   - it records every id that arrives more than once, with the offsets. The
 *     documentation claims ids are globally unique. Question 2 implies they are
 *     not, so the collision list is evidence either way, not an error.
 */

/** The real server-side ceiling. Asking for more just gets silently clamped. */
export const MAX_LIMIT = 50;

/**
 * Page a collection endpoint to exhaustion.
 *
 * @param {import('./session.js').Session} session
 * @param {string} pathname
 * @param {object} [opts]
 * @param {string} [opts.idKey]   'listing_id' | 'project_id' | ...
 * @param {object} [opts.query]   extra query params (filters, sorts)
 * @param {string} [opts.label]
 * @param {number} [opts.limit]
 * @param {(p: object) => void} [opts.onPage]
 */
export async function crawl(session, pathname, opts = {}) {
  const {
    idKey = 'listing_id',
    query = {},
    label = `crawl:${pathname}`,
    limit = MAX_LIMIT,
    onPage,
  } = opts;

  const records = [];
  const pages = [];
  const firstSeenAt = new Map(); // id -> offset where first seen
  const collisions = []; // { id, first_offset, repeat_offset }
  const problems = [];

  let offset = 0;
  let advertisedTotal = null;
  let prevSignature = null;
  let guard = 0;

  for (;;) {
    if (++guard > 400) {
      problems.push(`aborted: more than 400 pages fetched from ${pathname}`);
      break;
    }

    const res = await session.get(pathname, {
      query: { ...query, limit, offset },
      label: `${label}@${offset}`,
    });

    if (!res.ok) {
      problems.push(`offset=${offset} returned ${res.status}: ${JSON.stringify(res.json ?? res.text?.slice(0, 200))}`);
      break;
    }

    const env = res.json ?? {};
    const results = Array.isArray(env.results) ? env.results : Array.isArray(env) ? env : [];

    if (advertisedTotal === null) advertisedTotal = env.total ?? null;
    else if (env.total !== advertisedTotal) {
      problems.push(`total changed mid-crawl at offset=${offset}: ${advertisedTotal} -> ${env.total}`);
    }

    // Self-check: did the server honour what we asked for?
    if (env.limit !== undefined && env.limit !== limit) {
      problems.push(`offset=${offset}: requested limit=${limit}, server used ${env.limit}`);
    }
    if (env.offset !== undefined && env.offset !== offset) {
      problems.push(`offset=${offset}: server echoed offset ${env.offset}`);
    }
    if (env.count !== undefined && env.count !== results.length) {
      problems.push(`offset=${offset}: count=${env.count} but results.length=${results.length}`);
    }

    // Self-check: did the window actually move? Identical consecutive pages is
    // the signature of paging being ignored, which is precisely PAG-1.
    const signature = results.map((r) => r?.[idKey]).join('|');
    if (prevSignature !== null && signature === prevSignature && results.length > 0) {
      problems.push(`offset=${offset}: page identical to previous page - window did not move, aborting`);
      break;
    }
    prevSignature = signature;

    let fresh = 0;
    for (const rec of results) {
      const id = rec?.[idKey];
      if (id === undefined) {
        problems.push(`offset=${offset}: record with no ${idKey}`);
      } else if (firstSeenAt.has(id)) {
        collisions.push({ id, first_offset: firstSeenAt.get(id), repeat_offset: offset });
      } else {
        firstSeenAt.set(id, offset);
        fresh++;
      }
      records.push(rec);
    }

    const page = {
      offset,
      requested_limit: limit,
      echoed_limit: env.limit ?? null,
      count: env.count ?? results.length,
      total: env.total ?? null,
      has_more: env.has_more ?? null,
      new_ids: fresh,
      first_id: results[0]?.[idKey] ?? null,
      last_id: results.at(-1)?.[idKey] ?? null,
    };
    pages.push(page);
    onPage?.(page);

    if (env.has_more === false) break;
    if (results.length === 0) {
      if (env.has_more === true) problems.push(`offset=${offset}: empty page but has_more=true`);
      break;
    }

    // Advance by what the server actually used, not by what we asked for.
    offset += env.limit ?? results.length;
  }

  return {
    endpoint: pathname,
    query,
    records,
    pages,
    advertised_total: advertisedTotal,
    fetched_records: records.length,
    unique_ids: firstSeenAt.size,
    id_collisions: collisions,
    problems,
  };
}

/**
 * Re-fetch a window that has already been read and check it comes back the same.
 *
 * Offset paging is only sound if the server's ordering is stable. If it is not,
 * records can be skipped or repeated and the crawl is quietly incomplete - so
 * this needs to be established rather than assumed.
 */
export async function verifyStability(session, pathname, { idKey = 'listing_id', limit = 5, offsets = [0], expected = {} } = {}) {
  const checks = [];
  for (const offset of offsets) {
    const res = await session.get(pathname, { query: { limit, offset }, label: `stability:${pathname}@${offset}` });
    const got = (res.json?.results ?? []).map((r) => r?.[idKey]);
    const want = expected[offset] ?? null;
    checks.push({ offset, got, want, stable: want === null ? null : JSON.stringify(got) === JSON.stringify(want) });
  }
  return checks;
}

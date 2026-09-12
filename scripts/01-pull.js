/**
 * Step 1 - pull the whole dataset to disk, once.
 *
 * After this runs, nothing in the analysis touches the network. Every number in
 * submission.json is then reproducible from a fixed snapshot rather than from a
 * moving API, and re-running an analysis costs nothing.
 *
 * "Retrievable" in the assignment means: every record the key can obtain from
 * that endpoint *with no filters applied*, having paged all the way to the end.
 * So this pulls with no filters at all - the only query parameters sent are
 * `limit` and `offset`.
 *
 * Expected cost: ceil(3466/50) + ceil(1323/50) + ceil(401/50) = 70 + 27 + 9
 * = 106 requests, plus a handful of stability checks. The limit is 1200/minute.
 *
 * Run: node scripts/01-pull.js
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, j, stats } from './lib/http.js';
import { Session } from './lib/session.js';
import { crawl, verifyStability, MAX_LIMIT } from './lib/crawl.js';

const RAW = path.join(ROOT, 'data', 'raw');
fs.mkdirSync(RAW, { recursive: true });

const hr = (t) => console.log(`\n${'='.repeat(74)}\n${t}\n${'='.repeat(74)}`);
const session = new Session({ verbose: true });

const TARGETS = [
  { name: 'listings', pathname: '/v1/listings', idKey: 'listing_id' },
  { name: 'rentals', pathname: '/v1/rentals', idKey: 'listing_id' },
  { name: 'projects', pathname: '/v1/projects', idKey: 'project_id' },
];

const manifest = {
  pulled_at: new Date().toISOString(),
  max_limit_used: MAX_LIMIT,
  collections: {},
};

for (const t of TARGETS) {
  hr(`pulling ${t.pathname}`);

  const t0 = Date.now();
  const result = await crawl(session, t.pathname, {
    idKey: t.idKey,
    label: `pull:${t.name}`,
    onPage: (p) => {
      const pct = p.total ? ((p.offset + p.count) / p.total * 100).toFixed(0).padStart(3) : '  ?';
      process.stdout.write(
        `\r  offset ${String(p.offset).padStart(5)}  +${String(p.new_ids).padStart(2)} new  ` +
        `${pct}%  has_more=${p.has_more}   `,
      );
    },
  });
  process.stdout.write('\n');

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  advertised total : ${result.advertised_total}`);
  console.log(`  records fetched  : ${result.fetched_records}`);
  console.log(`  unique ${t.idKey.padEnd(10)}: ${result.unique_ids}`);
  console.log(`  pages            : ${result.pages.length}  in ${secs}s`);

  // The documentation claims ids are globally unique. Measure, do not assume.
  if (result.id_collisions.length) {
    console.log(`  *** ${result.id_collisions.length} repeated ${t.idKey} value(s) across the crawl ***`);
    for (const c of result.id_collisions.slice(0, 10)) {
      console.log(`      ${c.id}  first seen at offset ${c.first_offset}, again at ${c.repeat_offset}`);
    }
    if (result.id_collisions.length > 10) console.log(`      ... and ${result.id_collisions.length - 10} more`);
  } else {
    console.log(`  no repeated ${t.idKey} values`);
  }

  if (result.advertised_total !== null && result.fetched_records !== result.advertised_total) {
    console.log(`  *** MISMATCH: advertised total ${result.advertised_total} != ${result.fetched_records} fetched ***`);
  }

  if (result.problems.length) {
    console.log(`  problems flagged by the pager:`);
    for (const p of result.problems) console.log(`      - ${p}`);
  } else {
    console.log(`  pager self-checks all clean`);
  }

  // Is offset paging even sound here? It only is if the ordering is stable.
  const expected = {};
  const firstFive = result.records.slice(0, 5).map((r) => r[t.idKey]);
  const midOffset = Math.max(0, Math.floor(result.fetched_records / 2));
  expected[0] = firstFive;
  expected[midOffset] = result.records.slice(midOffset, midOffset + 5).map((r) => r[t.idKey]);
  const stability = await verifyStability(session, t.pathname, {
    idKey: t.idKey,
    limit: 5,
    offsets: [0, midOffset],
    expected,
  });
  const allStable = stability.every((c) => c.stable !== false);
  console.log(`  ordering stable on re-fetch: ${allStable ? 'yes' : 'NO - offset paging is not sound here'}`);
  for (const c of stability.filter((x) => x.stable === false)) {
    console.log(`      offset ${c.offset}: got ${c.got.join(',')} / expected ${c.want.join(',')}`);
  }

  fs.writeFileSync(path.join(RAW, `${t.name}.json`), JSON.stringify(result.records), 'utf8');
  fs.writeFileSync(path.join(RAW, `${t.name}.pages.json`), j(result.pages), 'utf8');

  manifest.collections[t.name] = {
    endpoint: t.pathname,
    id_key: t.idKey,
    advertised_total: result.advertised_total,
    fetched_records: result.fetched_records,
    unique_ids: result.unique_ids,
    pages: result.pages.length,
    seconds: Number(secs),
    id_collisions: result.id_collisions,
    problems: result.problems,
    ordering_stable_on_refetch: allStable,
    stability_checks: stability,
  };
}

hr('summary');
for (const [name, m] of Object.entries(manifest.collections)) {
  console.log(
    `${name.padEnd(9)} advertised=${String(m.advertised_total).padStart(5)}  ` +
    `fetched=${String(m.fetched_records).padStart(5)}  unique=${String(m.unique_ids).padStart(5)}  ` +
    `repeats=${String(m.id_collisions.length).padStart(3)}`,
  );
}
manifest.total_requests = stats().requests;
manifest.session_refreshes = session.refreshCount;
console.log(`\nrequests this run: ${stats().requests}  (token refreshes: ${session.refreshCount})`);

fs.writeFileSync(path.join(RAW, '_manifest.json'), j(manifest), 'utf8');
console.log(`wrote data/raw/{listings,rentals,projects}.json + _manifest.json`);

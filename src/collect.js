// The collection pipeline shared by the CLI, `--json` and the web API:
// pricing + every client parser + filters, with env/home threaded through
// so tests can point the whole pipeline at fixtures. No rendering, no
// command dispatch, no HTTP — importable without loading the web stack.

import os from 'node:os';

import { clients } from './clients/index.js';
import { computeCost, getPricing } from './pricing.js';

// Collects every client, applies filters, prices the result. `env`/`home` are
// threaded through to the parsers and pricing config so tests can point the
// whole pipeline at fixtures. Entries are never mutated here: pricing produces
// copies, so the per-client entry lists stay exactly what the parsers emitted.
export async function collectAll(opts, { env = process.env, home = os.homedir() } = {}) {
  const pricing = await getPricing({ offline: opts.offline, env, home });
  const warnings = [...pricing.warnings];

  const ids = Object.keys(clients);
  // Roots are resolved with the same injected env/home the collectors see,
  // then passed in and echoed through perClient: the `env` command and the
  // empty-state page render exactly what was scanned, without re-asking the
  // registry with process defaults.
  const rootsById = new Map(ids.map((id) => [id, clients[id].sourceRoots({ env, home })]));
  const results = await Promise.allSettled(
    ids.map((id) => clients[id].collect({ env, home, roots: rootsById.get(id) })),
  );

  const perClient = [];
  const all = [];
  ids.forEach((id, i) => {
    const r = results[i];
    let entries = [];
    if (r.status === 'fulfilled') {
      entries = r.value.entries;
      warnings.push(...r.value.warnings);
    } else {
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      warnings.push(`${id}: collection failed (${reason})`);
    }
    perClient.push({ id, label: clients[id].label, roots: rootsById.get(id), entries });
    // Loop, not spread: `all.push(...entries)` hits the ~65k argument limit
    // on machines with very large histories.
    for (const e of entries) all.push(e);
  });

  let filtered = all;
  if (opts.clients) filtered = filtered.filter((e) => opts.clients.includes(e.client));
  if (opts.since != null || opts.until != null) {
    let noTimestamp = 0;
    filtered = filtered.filter((e) => {
      // NaN counts as "no timestamp": `NaN < since` is false, so a numeric
      // null-check would let malformed timestamps through every window.
      if (!Number.isFinite(e.timestamp)) {
        noTimestamp += 1;
        return false;
      }
      if (opts.since != null && e.timestamp < opts.since) return false;
      if (opts.until != null && e.timestamp > opts.until) return false;
      return true;
    });
    // Silent exclusion would look like "no data" — say it instead.
    if (noTimestamp > 0) {
      warnings.push(`${noTimestamp} entries without a timestamp were excluded by --since/--until date filtering`);
    }
  }

  const entries = filtered.map((e) => {
    const costUsd = computeCost(e, pricing.priceFor(e.model));
    return costUsd === e.costUsd ? e : { ...e, costUsd };
  });

  return { entries, warnings, pricing, perClient };
}

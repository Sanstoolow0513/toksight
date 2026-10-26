// Quota collection for the `quota` command and the Web quota card; the data
// model lives in quotamodel.js.

import { codexQuota } from './codexquota.js';
import { kimiQuota } from './kimiquota.js';
import { QUOTA_CLIENTS, emptySnapshot, quotaError } from './quotamodel.js';

export { QUOTA_CLIENTS };

// Network is used only when `network` is true and the run is not offline;
// otherwise Kimi reports that it was skipped without touching credentials.
export async function collectQuotas({ clients = null, offline = false, network = true } = {}, { env = process.env, home, now = Date.now, fetchImpl, kimiCache } = {}) {
  const ids = (clients ?? QUOTA_CLIENTS).filter((id) => QUOTA_CLIENTS.includes(id));
  const quotas = [];
  for (const id of ids) {
    if (id === 'codex') quotas.push(await codexQuota({ env, home, now: now() }));
    else if (id === 'kimi') {
      if (!network || offline) {
        const cached = kimiCache?.get?.();
        if (cached) quotas.push(cached);
        else {
          const snap = emptySnapshot('kimi', 'api', now());
          snap.fetchedAt = null;
          snap.error = offline
            ? quotaError('KIMI_OFFLINE', 'skipped: offline mode (Kimi quota needs a network request)')
            : quotaError('KIMI_NOT_FETCHED', 'not fetched yet; refresh to query Kimi Code');
          quotas.push(snap);
        }
      } else {
        const snap = await kimiQuota({ env, home, now: now(), fetchImpl });
        kimiCache?.set?.(snap);
        quotas.push(snap);
      }
    }
  }
  return quotas;
}

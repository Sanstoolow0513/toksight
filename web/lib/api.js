// One fetch helper for every dashboard JSON call: always no-store, JSON
// content-type when a body is present, and the `x-toksight-action` header the
// server demands on write POSTs (that header forces a CORS preflight this
// server never answers, so foreign pages cannot fire writes). Non-2xx
// responses throw an Error carrying the server's message.

import { responseJson } from './config';

export async function fetchJson(url, { method = 'GET', body, signal, action } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (action) headers['x-toksight-action'] = action;
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
    cache: 'no-store',
  });
  return responseJson(res);
}

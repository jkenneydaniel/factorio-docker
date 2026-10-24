import {assert} from '../common.js';

export async function boundedJSON(fetcher, url, headers = {}) {
  const response = await fetcher(url, {headers: {accept: 'application/json', ...headers}, redirect: 'error', signal: AbortSignal.timeout(10000)});
  assert(response.ok && /\bjson\b/i.test(response.headers.get('content-type') || ''), 'The release service is unavailable.', 503);
  let size = 0; const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    assert(size <= 2 * 1024 ** 2, 'The release response is too large.', 503);
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

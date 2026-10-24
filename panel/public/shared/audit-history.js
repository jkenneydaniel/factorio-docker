import {escapeHTML as esc, formatDate} from './view.js';
export function mountAuditHistory(root, {request, notify}) {
  const abort = new AbortController();
  let cursor = null,
    version = 0;
  root.innerHTML =
    '<form data-audit-filter><label>History<select name="source"><option value="audit">Access and management requests</option><option value="operation-audit">Operation outcomes on this host or server</option></select></label><label>Filter actor, action or server<input name="search" maxlength="80" type="search"></label><button>Refresh audit history</button></form><p data-audit-retention></p><div class="table-wrap"><table><caption>Recorded requests and outcomes. Accepted requests may still be running.</caption><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Outcome</th></tr></thead><tbody data-audit-events></tbody></table></div><button type="button" data-audit-older hidden>Load older events</button>';
  const form = root.querySelector('form'),
    rows = root.querySelector('[data-audit-events]'),
    older = root.querySelector('[data-audit-older]');
  async function load(append = false) {
    const current = ++version;
    older.disabled = true;
    const query = new URLSearchParams({search: form.elements.search.value});
    if (append && cursor) query.set('before', cursor);
    try {
      const result = await request(
        '/' + form.elements.source.value + '?' + query,
        {signal: abort.signal},
      );
      if (abort.signal.aborted || current !== version) return;
      const html = (result.events || [])
        .map(
          (event) =>
            `<tr><td>${esc(formatDate(event.at))}</td><td>${esc(event.actor)}</td><td>${esc(event.action)}${event.operationId ? `<small>Operation ${esc(event.operationId)}</small>` : ''}</td><td>${esc(event.target || event.scope)}${event.accessChange ? `<details><summary>Access change</summary><pre>${esc(JSON.stringify(event.accessChange, null, 2))}</pre></details>` : ''}</td><td>${esc(event.outcome)}${event.status ? ' · HTTP ' + esc(event.status) : ''}</td></tr>`,
        )
        .join('');
      if (append) rows.insertAdjacentHTML('beforeend', html);
      else
        rows.innerHTML =
          html || '<tr><td colspan="5">No matching recorded events.</td></tr>';
      cursor = result.nextBefore;
      older.hidden = !cursor;
      root.querySelector('[data-audit-retention]').textContent =
        'Retains up to ' +
        (result.limit || 10000) +
        ' events per store. ' +
        (result.prunedThrough
          ? 'Older events through sequence ' +
            result.prunedThrough +
            ' have expired.'
          : 'No older events have expired.');
    } catch (error) {
      if (!abort.signal.aborted) notify(error.message, true);
    } finally {
      older.disabled = false;
    }
  }
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void load();
  });
  older.addEventListener('click', () => void load(true));
  return {
    load,
    dispose() {
      version++;
      abort.abort();
    },
  };
}

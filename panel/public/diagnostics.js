import {icon} from './icons.js';
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        c
      ],
  );
export function diagnosticsPage(report) {
  const issues = report.checks.filter((c) =>
      ['error', 'warning'].includes(c.state),
    ),
    labels = {
      pass: 'Passed',
      warning: 'Needs attention',
      error: 'Needs attention',
      unknown: 'Not confirmed',
      manual: 'Try it yourself',
    };
  return `<div class="diagnostic-summary card"><div class="card-body"><div class="eyebrow">READ-ONLY HEALTH CHECK</div><h2>${issues.length ? `${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to look into.` : 'Your checks are ready.'}</h2><p class="form-note">Follow the steps below to narrow down a problem. These checks don’t change settings, write test files or restart anything.</p><p class="hint">Checked ${esc(new Date(report.checkedAt).toLocaleString())}</p><div class="button-group"><button class="button primary" id="run-diagnostics">${icon('refresh')} Check again</button><button class="button" id="download-diagnostics">${icon('download')} Download support report</button></div><p class="hint">Report includes check results and panel versions. It excludes account details, addresses, paths, world names, settings and raw logs.</p></div></div><div class="diagnostic-checks">${[
    ...report.checks,
  ]
    .sort(
      (a, b) =>
        ({error: 0, warning: 1, unknown: 2, pass: 3, manual: 4})[a.state] -
        {error: 0, warning: 1, unknown: 2, pass: 3, manual: 4}[b.state],
    )
    .map(
      (c) =>
        `<details class="card diagnostic-check" ${['error', 'warning'].includes(c.state) ? 'open' : ''}><summary><span class="diagnostic-icon ${c.state}">${icon(c.state === 'pass' ? 'circle-check' : c.state === 'manual' ? 'link' : c.state === 'unknown' ? 'help' : 'alert-circle')}</span><span>${esc(c.title)}</span><span class="mini-pill ${c.state === 'pass' ? '' : 'pending'}">${labels[c.state] || 'Not confirmed'}</span></summary><div class="card-body"><p>${esc(c.detail)}</p>${c.steps?.length ? `<ol>${c.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}${c.link && ['#settings', '#overview'].includes(c.link) ? `<a class="button small" href="${c.link}">Open ${c.link === '#overview' ? 'Overview' : 'connection settings'} ${icon('arrow-right')}</a>` : ''}</div></details>`,
    )
    .join('')}</div>`;
}
export function downloadJSON(value, name) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}),
    ),
    link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

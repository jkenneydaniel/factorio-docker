/** @param {unknown} value */
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[
        character
      ] ?? character,
  );
/** @param {number|null|undefined} value */
export const formatBytes = (value) =>
  value == null
    ? '—'
    : value >= 1024 ** 3
      ? (value / 1024 ** 3).toFixed(1) + ' GiB'
      : value >= 1024 ** 2
        ? (value / 1024 ** 2).toFixed(1) + ' MiB'
        : value >= 1024
          ? (value / 1024).toFixed(1) + ' KiB'
          : value + ' B';
/** @param {string|null|undefined} value */
export const formatDate = (value) =>
  value ? new Date(value).toLocaleString() : 'Not yet';
/**
 * @param {import('./contracts.js').OperationJob|null|undefined} job
 * @param {import('./contracts.js').OperationJob|null} active
 * @returns {job is import('./contracts.js').OperationJob}
 */
export const operationFinished = (job, active) =>
  !!job && !['running', 'queued'].includes(job.state) && !active;

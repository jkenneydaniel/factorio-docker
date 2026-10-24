import {createEventScope} from '../shared/events.js';
import {escapeHTML as esc} from '../shared/view.js';
export function createHostSettings({api, getSession, error}) {
  const events = createEventScope((problem) =>
    error(problem.message, '#host-error'),
  );
  const $ = (selector) => document.querySelector(selector);
  let generation = 0;
  let hostSettings = null,
    hostDirty = false,
    hostSaving = false,
    hostLoading = false,
    hostDraftRevision = 0;
  function renderHostSettings(resetDraft = false) {
    const data = hostSettings;
    if (!data) return;
    const admin = getSession()?.role === 'admin',
      capacityKnown = data.maxMemoryBudgetGiB !== null,
      conflict = hostDirty && hostDraftRevision !== data.revision;
    $('#host-summary').innerHTML = [
      ['Host budget', data.memoryBudgetGiB + ' GiB'],
      ['Allocated', data.allocatedMemoryGiB + ' GiB'],
      ['Available to allocate', data.availableMemoryGiB + ' GiB'],
      [
        'Docker memory',
        data.dockerMemoryGiB === null
          ? 'Unavailable'
          : data.dockerMemoryGiB.toFixed(1) + ' GiB',
      ],
    ]
      .map(
        ([label, value]) =>
          `<div class="card"><strong>${esc(value)}</strong><p>${esc(label)}</p></div>`,
      )
      .join('');
    const meter = $('#host-allocation-meter');
    meter.max = Math.max(1, data.memoryBudgetGiB);
    meter.value = data.allocatedMemoryGiB;
    meter.textContent = `${data.allocatedMemoryGiB} of ${data.memoryBudgetGiB} GiB allocated`;
    $('#host-allocations').innerHTML = data.allocations.length
      ? data.allocations
          .map(
            (item) =>
              `<tr><th scope="row">${esc(item.name)}<small>${esc(item.game.charAt(0).toUpperCase() + item.game.slice(1))}</small></th><td>${esc(item.gameGiB)} GiB</td><td>${esc(item.controllerGiB)} GiB</td><td>${esc(item.totalGiB)} GiB</td></tr>`,
          )
          .join('')
      : '<tr><td colspan="4">No managed servers have memory allocated yet.</td></tr>';
    $('#host-allocated-total').textContent = data.allocatedMemoryGiB + ' GiB';
    const input = $('#host-budget');
    input.min = data.minMemoryBudgetGiB;
    input.max = data.maxMemoryBudgetGiB ?? 128;
    if (!hostDirty || resetDraft) {
      input.value = data.memoryBudgetGiB;
      hostDraftRevision = data.revision;
      hostDirty = false;
    }
    input.disabled =
      !admin ||
      hostSaving ||
      !capacityKnown ||
      data.maxMemoryBudgetGiB < data.minMemoryBudgetGiB;
    $('#save-host-settings').disabled =
      input.disabled || (!resetDraft && conflict);
    $('#host-readonly').hidden = admin;
    $('#host-conflict').hidden = resetDraft || !conflict;
    $('#host-budget-help').textContent =
      capacityKnown && data.maxMemoryBudgetGiB < data.minMemoryBudgetGiB
        ? 'Docker cannot currently accommodate existing allocations with management headroom. Increase Docker’s memory limit or remove a server before changing the budget.'
        : capacityKnown
          ? `Choose ${data.minMemoryBudgetGiB}–${data.maxMemoryBudgetGiB} GiB. Keep at least ${data.hostHeadroomGiB} GiB of Docker memory outside the budget, plus room for other workloads.`
          : 'Docker memory capacity is unavailable. Budget changes are temporarily unavailable.';
  }
  async function loadHostSettings({resetDraft = false} = {}) {
    if (hostLoading || hostSaving) return;
    hostLoading = true;
    const version = generation;
    try {
      const data = await api('/host-settings');
      if (version !== generation) return;
      if (!hostSettings || data.revision >= hostSettings.revision) {
        hostSettings = data;
        renderHostSettings(resetDraft);
      }
      error('', '#host-error');
    } catch (e) {
      if (version === generation) error(e.message, '#host-error');
    } finally {
      if (version === generation) hostLoading = false;
    }
  }
  function bind() {
    events.clear();
    events.set($('#host-budget'), 'input', () => {
      hostDirty = true;
      $('#host-saved').hidden = true;
    });

    events.set($('#reload-host'), 'click', () =>
      loadHostSettings({resetDraft: true}),
    );
    events.set($('#host-settings-form'), 'submit', async (event) => {
      event.preventDefault();
      if (!hostSettings || hostSaving || getSession()?.role !== 'admin') return;
      hostSaving = true;
      const version = generation;
      renderHostSettings();
      error('', '#host-error');
      $('#host-saved').hidden = true;
      try {
        const result = await api('/host-settings', {
          memoryBudgetGiB: Number($('#host-budget').value),
          revision: hostDraftRevision,
        });
        if (version !== generation) return;
        hostSettings = result;
        hostDirty = false;
        renderHostSettings(true);
        $('#host-saved').textContent =
          'Memory budget saved. Existing servers stayed running.';
        $('#host-saved').hidden = false;
      } catch (e) {
        if (version === generation) error(e.message, '#host-error');
      } finally {
        if (version === generation) {
          hostSaving = false;
          renderHostSettings();
        }
      }
    });
  }
  bind();
  return {
    load: loadHostSettings,
    render: renderHostSettings,
    bind,
    dispose() {
      generation++;
      hostLoading = false;
      hostSaving = false;
      events.clear();
    },
  };
}

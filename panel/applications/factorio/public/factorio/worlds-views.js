import {serverPath} from '../scope.js';
import {worldForm} from '../world-editor.js';
import {fragment, iconNode, part, text} from '../shared/templates.js';

export function createWorldsViews(getState, ui) {
  const {template, pretty, bytes, date, heading, readonly, jobBanner, empty} =
    ui;
  function canViewMap() {
    const {user, can} = getState();
    return user?.role === 'viewer' || can('application.factorio.map.view');
  }
  function worldRows(worlds) {
    const {busyJob, worldSearch, worldFilter, admin, can} = getState();
    const filtered = worlds.filter(
      (world) =>
        (!worldSearch ||
          world.name.toLowerCase().includes(worldSearch.toLowerCase())) &&
        (worldFilter === 'all' ||
          (worldFilter === 'autosaves' && world.kind === 'autosave') ||
          (worldFilter === 'library' && world.kind === 'archive') ||
          (worldFilter === 'active' && world.current)),
    );
    if (!filtered.length)
      return empty(
        'No worlds in this view.',
        'Try another filter or create your next world.',
      );
    const view = template('world-table');
    for (const world of filtered) {
      const row = template('world-row');
      if (world.hasPreview && canViewMap()) {
        const image = template('world-thumbnail'),
          img = part(image, 'img');
        img.src = serverPath('/api/preview?id=') + encodeURIComponent(world.id);
        img.alt = 'Terrain preview for ' + world.name;
        part(row, '[data-part=image]').append(image);
      } else part(row, '[data-part=image]').append(iconNode('world'));
      text(row, '.name', pretty(world.name));
      text(
        row,
        '.secondary',
        world.current
          ? 'Active world'
          : world.kind === 'autosave'
            ? 'Rolling autosave'
            : world.kind === 'archive'
              ? 'World library'
              : 'Saved world',
      );
      text(row, '[data-part=modified]', date(world.modified));
      text(row, '[data-part=size]', bytes(world.size));
      if (can('worlds.download'))
        part(row, '[data-part=download]').href =
          serverPath('/api/download?kind=world&id=') +
          encodeURIComponent(world.id);
      else part(row, '[data-part=download]').remove();
      if (world.hasPreview && canViewMap())
        part(row, '[data-preview]').dataset.preview = world.id;
      else part(row, '[data-preview]').remove();
      const load = part(row, '[data-load-world]');
      if (!world.current && admin()) {
        load.dataset.loadWorld = world.id;
        load.dataset.name = world.name;
        load.disabled = !!busyJob;
      } else load.remove();
      part(view, 'tbody').append(row);
    }
    return view;
  }
  function worldPage(worlds) {
    const {
      status,
      busyJob,
      recoveryRequired,
      worldOptions,
      worldSearch,
      worldFilter,
      createdWorld,
      admin,
    } = getState();
    if (admin() && location.hash === '#worlds/create')
      return fragment(
        jobBanner(),
        worldForm(worldOptions, !!busyJob || recoveryRequired, template),
      );
    if (createdWorld && location.hash === '#worlds/created') {
      const world = worlds.find(
          (w) =>
            w.name === createdWorld.name + '.zip' ||
            w.name === createdWorld.name,
        ),
        view = template('world-created');
      text(view, 'h1', createdWorld.name + ' is ready.');
      text(view, 'p', createdWorld.message);
      if (world?.hasPreview && canViewMap()) {
        part(view, 'img').src =
          serverPath('/api/preview?id=') + encodeURIComponent(world.id);
        part(view, 'img').alt = 'Generated preview of ' + world.name;
      } else part(view, 'img').remove();
      return view;
    }
    const actions = admin() ? template('world-actions') : null,
      view = template('world-library');
    if (actions)
      text(
        actions,
        '[data-part=create-label]',
        worldOptions?.setups?.draft ? 'Resume draft' : 'Create a world',
      );
    if (admin() && worldOptions?.setups?.draft)
      text(
        view,
        '[data-part=draft-name]',
        'Pick up where you left off: ' +
          (worldOptions.setups.draft.name || 'Untitled world'),
      );
    else part(view, '.setup-resume').remove();
    text(
      view,
      '.world-current h2',
      pretty(status.currentWorld) || 'No world loaded',
    );
    if (!admin()) part(view, '.world-forms').remove();
    else {
      part(view, '.world-forms details').open =
        location.hash === '#worlds/import';
      part(view, '#upload-form button').disabled = !!busyJob;
    }
    for (const button of view.querySelectorAll('[data-world-filter]')) {
      const active = button.dataset.worldFilter === worldFilter;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    part(view, '#world-search').value = worldSearch;
    text(
      view,
      '[data-part=count]',
      worlds.length + ' ' + (worlds.length === 1 ? 'save' : 'saves'),
    );
    part(view, '#world-results').append(worldRows(worlds));
    return fragment(
      heading(
        'WORLD LIBRARY',
        'Your worlds. Your next adventure.',
        'Start fresh, import a favourite save, or return to a familiar factory.',
        actions,
      ),
      readonly(),
      jobBanner(),
      view,
    );
  }
  return {worldRows, worldPage};
}

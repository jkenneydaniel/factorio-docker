import {gameUpdateModel, gameUpdate} from './game-images.js';
import {part, text} from './shared/templates.js';
export function gameUpdateForm(image, disabled, template) {
  const {current, blocked, sources} = gameUpdateModel(image, disabled),
    view = template('game-update-form');
  text(view, '[data-part=current-image]', image || 'Unavailable');
  if (current) part(view, '[data-part=unsupported]').remove();
  const select = part(view, '[name=source]');
  select.append(
    ...sources.map(
      (source) =>
        new Option(
          source.name,
          source.id,
          false,
          source.id === current?.source,
        ),
    ),
  );
  part(view, '[name=version]').value = current?.version || '';
  part(view, '[name=imageRevision]').value = String(current?.revision || 1);
  part(view, '#image-revision-field').hidden = current?.source !== 'factory';
  for (const control of view.querySelectorAll('input,select,button'))
    control.disabled = blocked;
  return view;
}
export function bindGameUpdate(image, review, notify) {
  const form = document.querySelector('#game-update-form');
  if (!form) return;
  const source = form.elements.source,
    revision = form.elements.imageRevision;
  const update = () => {
    const owned = source.value === 'factory';
    document.querySelector('#image-revision-field').hidden = !owned;
    revision.disabled = source.disabled || !owned;
    document.querySelector('#game-image-choice').textContent = owned
      ? 'Lobby Goblin is built directly from Debian and the official Factorio download.'
      : 'Lobby Goblin is the supported image source.';
  };
  source.addEventListener('change', update);
  update();
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const selection = gameUpdate(image, {
        target: form.elements.version.value,
        source: source.value,
        ...(source.value === 'factory'
          ? {imageRevision: Number(revision.value)}
          : {}),
      });
      review('game', selection.target, {
        source: selection.source,
        imageRevision: selection.imageRevision,
      });
    } catch (error) {
      notify(error.message, true);
    }
  });
}

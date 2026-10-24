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
  for (const control of view.querySelectorAll('input,select,button'))
    control.disabled = blocked;
  return view;
}
export function bindGameUpdate(image, review, notify, context) {
  const form = document.querySelector('#game-update-form');
  if (!form) return;
  const source = form.elements.source,
    revision = form.elements.imageRevision;
  const update = () => {
    const owned = source.value === 'factory';
    revision.disabled = source.disabled || !owned;
    document.querySelector('#game-image-choice').textContent = owned
      ? 'Lobby Goblin is built directly from Debian and the official Factorio download.'
      : 'Lobby Goblin is the supported image source.';
  };
  source.addEventListener('change', update, {signal: context?.signal});
  update();
  form.addEventListener(
    'submit',
    (event) => {
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
    },
    {signal: context?.signal},
  );
  if (!context) return;
  const choices = form.elements.release,
    button = form.querySelector('button'),
    blocked = source.disabled;
  choices.disabled = true;
  button.disabled = true;
  void context
    .request('/application-releases')
    .then((data) => {
      if (context.signal.aborted || !form.isConnected) return;
      const current = gameUpdateModel(image).current;
      const available = (data.stale ? [] : data.choices).filter((choice) => {
        try {
          gameUpdate(image, {
            target: choice.version,
            imageRevision: choice.imageRevision,
          });
          return true;
        } catch {
          return false;
        }
      });
      choices.replaceChildren(
        ...available.map(
          (choice) =>
            new Option(
              choice.version +
                ' · image revision ' +
                choice.imageRevision +
                ' · ' +
                choice.channel,
              choice.image,
            ),
        ),
      );
      if (!available.length)
        choices.append(new Option('No newer compatible image available', ''));
      const note = document.querySelector('#game-release-status'),
        link = document.querySelector('#game-release-notes');
      note.textContent =
        data.error ||
        data.imageError ||
        'Latest stable: ' +
          data.stable +
          (data.experimental ? ' · experimental: ' + data.experimental : '') +
          '. Only published compatible images can be installed.';
      const choose = () => {
        const choice = available.find((value) => value.image === choices.value);
        form.elements.version.value = choice?.version || current?.version || '';
        revision.value = String(
          choice?.imageRevision || current?.revision || 1,
        );
        link.hidden = !choice;
        if (choice) link.href = choice.notesUrl;
      };
      choices.addEventListener('change', choose, {signal: context.signal});
      choose();
      choices.disabled = blocked || !available.length;
      button.disabled = blocked || !available.length;
    })
    .catch((error) => {
      if (!context.signal.aborted && form.isConnected)
        document.querySelector('#game-release-status').textContent =
          error.message;
    });
}

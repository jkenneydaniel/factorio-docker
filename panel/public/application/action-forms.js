/** @param {{ready?:boolean,running?:boolean}|null} status @param {import('./contracts.js').Availability} [state] */
export function actionAvailable(status, state) {
  if (!state || state === 'always') return true;
  return state === 'ready'
    ? status?.ready === true
    : state === 'running'
      ? status?.running === true
      : status?.running === false;
}

/** @param {import('./contracts.js').FieldDescriptor} field @param {import('./contracts.js').FormValue|undefined} value */
export function fieldControl(field, value) {
  const input = document.createElement(
    field.type === 'select'
      ? 'select'
      : field.type === 'textarea'
        ? 'textarea'
        : 'input',
  );
  if (input instanceof HTMLInputElement)
    input.type = field.type === 'boolean' ? 'checkbox' : field.type;
  input.name = field.key;
  input.setAttribute('aria-label', field.label);
  input.required = field.required === true;
  if (field.placeholder && !(input instanceof HTMLSelectElement))
    input.placeholder = field.placeholder;
  if (field.type === 'password') input.autocomplete = 'new-password';
  if (field.type === 'select')
    for (const choice of field.choices || [])
      input.append(new Option(choice.label, choice.value));
  else if (field.type === 'number' && input instanceof HTMLInputElement) {
    if (field.min !== undefined) input.min = String(field.min);
    if (field.max !== undefined) input.max = String(field.max);
  } else if (field.max && !(input instanceof HTMLSelectElement))
    input.maxLength = field.max;
  if (field.type === 'boolean' && input instanceof HTMLInputElement)
    input.checked = value === true;
  else if (value !== undefined) input.value = String(value ?? '');
  return input;
}

/** @template T @param {T|null} element @returns {T} */
function required(element) {
  if (element === null) throw Error('The shared form template is incomplete.');
  return element;
}
/** @param {Element|RadioNodeList|null} element */
function formControl(element) {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  )
    return element;
  throw Error('The action field is missing.');
}

// One shared form implementation. Descriptors choose typed fields and an
// already-declared action; confirmation and submission expire with the screen.
/** @param {import('../shared/contracts.js').ScreenContext} ctx @param {import('./contracts.js').ActionFormDescriptor[]|undefined} descriptors @param {import('./contracts.js').ActionFormContext} options */
export function mountActionForms(
  ctx,
  descriptors,
  {clone, canAction, busy, getStatus, startJob, drafts},
) {
  const container = ctx.root.querySelector('[data-forms]');
  if (!container) return {setBusy() {}};
  /** @type {{form:HTMLFormElement,state:import('./contracts.js').Availability|undefined}[]} */
  const activeForms = [];
  for (const descriptor of descriptors || []) {
    if (!canAction(descriptor.action)) continue;
    const fragment = clone('action-form'),
      form = required(fragment.querySelector('form')),
      output = required(fragment.querySelector('pre'));
    form.id = descriptor.id;
    form.dataset.operationForm = descriptor.action;
    form.dataset.availability = descriptor.availability || 'always';
    required(fragment.querySelector('[data-heading]')).textContent =
      descriptor.heading;
    required(fragment.querySelector('[data-description]')).textContent =
      descriptor.description || '';
    required(form.querySelector('button')).textContent = descriptor.submitLabel;
    if (descriptor.resultId) {
      output.id = descriptor.resultId;
      output.hidden = false;
    }
    for (const field of descriptor.fields) {
      const row = clone('field'),
        input = fieldControl(field, drafts.get(descriptor.id)?.[field.key]);
      required(row.querySelector('[data-label]')).textContent = field.label;
      required(row.querySelector('[data-control]')).replaceWith(input);
      required(row.querySelector('[data-help]')).remove();
      required(form.querySelector('[data-fields]')).append(row);
    }
    const values = () =>
      Object.fromEntries(
        descriptor.fields.map((field) => {
          const input = formControl(form.elements.namedItem(field.key));
          return [
            field.key,
            field.type === 'boolean'
              ? input instanceof HTMLInputElement && input.checked
              : field.type === 'number'
                ? Number(input.value)
                : input.value,
          ];
        }),
      );
    ctx.on(form, 'input', () => {
      drafts.set(descriptor.id, values());
    });
    ctx.on(form, 'submit', async (event) => {
      event.preventDefault();
      if (busy() || !actionAvailable(getStatus(), descriptor.availability))
        return;
      const params = values();
      if (descriptor.confirmation) {
        if (
          !(await ctx.confirm(
            descriptor.confirmation.title,
            descriptor.confirmation.message,
          ))
        )
          return;
        params.confirm = true;
      }
      const result = await startJob(descriptor.action, params, {wait: true});
      if (ctx.isCurrent() && result && descriptor.resultId)
        output.textContent =
          typeof result.result === 'string' ? result.result : result.message;
    });
    container.append(fragment);
    activeForms.push({form, state: descriptor.availability});
  }
  return {
    setBusy() {
      for (const {form, state} of activeForms)
        for (const control of Array.from(form.elements))
          if (
            control instanceof HTMLInputElement ||
            control instanceof HTMLSelectElement ||
            control instanceof HTMLTextAreaElement ||
            control instanceof HTMLButtonElement
          )
            control.disabled = busy() || !actionAvailable(getStatus(), state);
    },
  };
}

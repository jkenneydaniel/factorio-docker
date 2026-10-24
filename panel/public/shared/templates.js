import {serverPath} from '../scope.js';
import {icon} from '../icons.js';

// Only reviewed controllers choose an asset. Public application definitions never
// provide template paths, expressions, HTML or executable binding instructions.
export async function loadTemplates(path, signal) {
  const response = await fetch(serverPath(path), {signal});
  if (!response.ok)
    throw Error(
      'Application controls could not be loaded. Reload to try again.',
    );
  const holder = document.createElement('template');
  holder.innerHTML = await response.text();
  const templates = new Map();
  for (const entry of holder.content.children) {
    if (
      !(entry instanceof HTMLTemplateElement) ||
      !entry.id ||
      templates.has(entry.id)
    )
      throw Error('Invalid application template asset.');
    templates.set(entry.id, entry);
  }
  return (name) => {
    const source = templates.get(name);
    if (!source) throw Error('Unknown application template: ' + name);
    const result = source.content.cloneNode(true);
    for (const element of result.querySelectorAll('[data-icon]'))
      element.replaceChildren(iconNode(element.dataset.icon));
    return result;
  };
}
export function part(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw Error('Missing application template part: ' + selector);
  return element;
}
export function text(root, selector, value) {
  part(root, selector).textContent = String(value ?? '');
}
export function fragment(...children) {
  const result = document.createDocumentFragment();
  result.append(
    ...children.filter((child) => child !== null && child !== undefined),
  );
  return result;
}
export function iconNode(name) {
  const holder = document.createElement('template');
  // icon() accepts only the shared, fixed icon vocabulary. Instance data is
  // always assigned with textContent/DOM properties by the calling controller.
  holder.innerHTML = icon(name);
  return holder.content;
}

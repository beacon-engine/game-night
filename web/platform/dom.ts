// An element by id. Pages are static html, so a missing one is a bug: fail loudly.
export function $<E extends HTMLElement = HTMLElement>(id: string): E {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as E;
}

export function escapeHtml(s: unknown) {
  return String(s).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

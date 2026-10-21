// The pad's four face buttons are Beacon Arcade's own icons, drawn here (not any console's symbols):
// Bolt (bottom: the main action), Drop (right: back), Leaf (left), Star (top). 24-unit line drawings in
// the brand's style; they take the colour of the text around them. Rules: brand/README.md.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICON = {
  bolt: svg('<path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>'),
  drop: svg('<path d="M12 3.2c3.6 4.4 6.2 7.6 6.2 10.9a6.2 6.2 0 0 1-12.4 0c0-3.3 2.6-6.5 6.2-10.9z"/>'),
  leaf: svg('<path d="M5 19.5C5 11 10 5 20 4c-.6 9.8-6.6 15.5-15 15.5z"/><path d="M5 19.5 13 11.5"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 16.9l-5.4 2.9 1-6.1-4.4-4.3 6.1-.8z"/>'),
  // the stars players earn: a coin with a star in it, so it's never mistaken for the Star button
  coin: svg('<circle cx="12" cy="12" r="9"/><path d="m12 7.2 1.5 3 3.3.5-2.4 2.3.6 3.3-3-1.6-3 1.6.6-3.3-2.4-2.3 3.3-.5z" fill="currentColor" stroke-width="1"/>'),
} as const;

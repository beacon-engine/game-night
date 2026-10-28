// Splitting the screen: one view for one person, top and bottom for two, quarters for three or four
// (the spare quarter shows the TV camera)

// A rectangle of the screen, as fractions from the top left
export interface Rect { x: number; y: number; w: number; h: number }

export const layout = (n: number): Rect[] => n <= 1 ? [{ x: 0, y: 0, w: 1, h: 1 }]
  : n === 2 ? [{ x: 0, y: 0, w: 1, h: 0.5 }, { x: 0, y: 0.5, w: 1, h: 0.5 }]
  : [{ x: 0, y: 0, w: 0.5, h: 0.5 }, { x: 0.5, y: 0, w: 0.5, h: 0.5 }, { x: 0, y: 0.5, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }];

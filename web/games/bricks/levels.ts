// The walls, drawn by hand. Each is 12 bricks across; the top line is the top row.
//
//   .  no brick
//   1  a brick (one hit)
//   2  a tough brick (two hits)          3  tougher (three hits)
//   #  steel: never breaks (it doesn't count toward clearing the wall)
//   *  a charge: blows up the bricks around it, steel aside (and sets off other charges)
//   ?  a brick that always drops a power-up
//
// The colours go down the wall row by row from the level's palette.

export interface Level {
  name: string;
  rows: string[];
  palette: string[];
  versus?: boolean; // also used for versus rounds (quick to clear)
}

export const LEVELS: Level[] = [
  {
    name: 'First Light',
    versus: true,
    palette: ['#ff4d5a', '#ff8a3d', '#ffc23d', '#2ee59d', '#3fd7e8', '#4c8dff'],
    rows: [
      '222222222222',
      '111111111111',
      '111?1111?111',
      '111111111111',
      '111111111111',
      '111111111111',
    ],
  },
  {
    name: 'Archway',
    palette: ['#a97bff', '#ff5ecf', '#ff8a3d', '#ffc23d', '#2ee59d', '#3fd7e8', '#4c8dff', '#4c8dff'],
    rows: [
      '....2222....',
      '..22111122..',
      '.2111??1112.',
      '211111111112',
      '11#......#11',
      '11........11',
      '11........11',
      '##........##',
    ],
  },
  {
    name: 'Fuse Box',
    versus: true,
    palette: ['#ffc23d', '#ff8a3d', '#ffc23d', '#ff4d5a', '#ffc23d', '#ff8a3d', '#ffc23d', '#ffc23d'],
    rows: [
      '111111111111',
      '1*11*11*11*1',
      '111111111111',
      '222222222222',
      '1*11*11*11*1',
      '111111111111',
      '............',
      '..##....##..',
    ],
  },
  {
    name: 'Checkers',
    versus: true,
    palette: ['#3fd7e8', '#4c8dff', '#3fd7e8', '#4c8dff', '#3fd7e8', '#4c8dff'],
    rows: [
      '2.2.2.2.2.2.',
      '.1.1.1.1.1.1',
      '2.2.2.2.2.2.',
      '.1.?.1.1.?.1',
      '2.2.2.2.2.2.',
      '.1.1.1.1.1.1',
    ],
  },
  {
    name: 'Diamond',
    versus: true,
    palette: ['#ff5ecf', '#ff5ecf', '#a97bff', '#ff4d5a', '#a97bff', '#ff5ecf', '#ff5ecf', '#a97bff', '#a97bff'],
    rows: [
      '.....22.....',
      '....2112....',
      '...211112...',
      '..21?**?12..',
      '...211112...',
      '....2112....',
      '.....22.....',
      '............',
      '#..........#',
    ],
  },
  {
    name: 'The Vee',
    palette: ['#2ee59d', '#3fd7e8', '#4c8dff', '#a97bff', '#ff5ecf', '#ffc23d', '#ffc23d'],
    rows: [
      '3..........3',
      '23........32',
      '123......321',
      '1123....3211',
      '11123..32111',
      '1?11*33*11?1',
      '##........##',
    ],
  },
  {
    name: 'Lantern',
    palette: ['#a6a4ae', '#ffc23d', '#ff8a3d', '#ffc23d', '#ff8a3d', '#ffc23d', '#ff4d5a', '#4c8dff', '#3fd7e8'],
    rows: [
      '....####....',
      '...#2222#...',
      '...2*11*2...',
      '...211112...',
      '...2?11?2...',
      '...222222...',
      '....3333....',
      '..11111111..',
      '.1111111111.',
    ],
  },
  {
    name: 'Fortress',
    palette: ['#ff4d5a', '#ff8a3d', '#ffc23d', '#ffc23d', '#2ee59d', '#2ee59d', '#4c8dff', '#4c8dff', '#a97bff'],
    rows: [
      '22.222222.22',
      '#1111111111#',
      '#1#3*33*3#1#',
      '#1#333333#1#',
      '#1#2?22?2#1#',
      '#1#......#1#',
      '#11111111111',
      '.........#..',
    ],
  },
  {
    name: 'Gauntlet',
    palette: ['#ff5ecf', '#a97bff', '#4c8dff', '#3fd7e8', '#2ee59d', '#2ee59d'],
    rows: [
      '333333333333',
      '#2*2#22#2*2#',
      '#222#22#222#',
      '#111#?1#111#',
      '#111#..#111#',
      '#...#..#...#',
    ],
  },
  {
    name: 'Last Wall',
    palette: ['#ff4d5a', '#ff8a3d', '#ffc23d', '#2ee59d', '#3fd7e8', '#4c8dff', '#a97bff', '#a6a4ae'],
    rows: [
      '*3333333333*',
      '323232323232',
      '2*22222222*2',
      '232323232323',
      '1?11*11*11?1',
      '111111111111',
      '111111111111',
      '#.#.#..#.#.#',
    ],
  },
];

export const VERSUS_LEVELS = LEVELS.map((l, i) => (l.versus ? i : -1)).filter((i) => i >= 0);

// (a wrong line in a level is a typo: say so in the console rather than draw a broken wall)
for (const l of LEVELS) {
  for (const r of l.rows) if (r.length !== 12 || /[^.123#*?]/.test(r)) console.warn(`[bricks] level "${l.name}": bad row "${r}"`);
}

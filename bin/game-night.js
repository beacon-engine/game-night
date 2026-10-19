#!/usr/bin/env node
// `npx game-night`: start the host and open the game select page in the browser.
// Pass --no-open to only start the server.
if (!process.argv.includes('--no-open')) process.env.OPEN_BROWSER = '1';
require('../server.js');

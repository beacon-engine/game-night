// Keep the screen on while a page with players on it is open: nobody touches the laptop during a
// game (they're on their phones), so it would otherwise dim and sleep. The browser lets go of the
// lock whenever the page is hidden, so it's taken again when the page comes back. The TV app keeps
// its own screen on, and the server keeps the machine awake while phones are playing (awake.go),
// for browsers that refuse the lock (no Wake Lock API, or a plain-http LAN address).

let lock: WakeLockSentinel | null = null;
let asked = false;

export function keepAwake() {
  if (asked || !('wakeLock' in navigator)) return;
  asked = true;
  const take = () => {
    if (lock && !lock.released) return;
    navigator.wakeLock.request('screen').then((l) => {
      lock = l;
      // the OS can drop it too (battery saver, say): ask again if the page is still showing
      l.addEventListener('release', () => { if (document.visibilityState === 'visible') setTimeout(take, 1000); });
    }).catch(() => { /* not allowed right now */ });
  };
  take();
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') take(); });
  // some browsers only allow it after a click or key: try again on the first one
  addEventListener('pointerdown', take, { once: true });
  addEventListener('keydown', take, { once: true });
}

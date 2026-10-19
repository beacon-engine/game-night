// Night stadium: mown pitch with real markings, goals with nets, two-tier stands,
// LED ad boards, floodlight towers with glow, and a night sky.
import * as THREE from 'three';
import type { Settings, TimeOfDay } from './types.ts';

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

function canvasTex(w: number, h: number, draw: Draw, opts: { repeat?: [number, number] } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 16;
  if (opts.repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...opts.repeat);
  }
  return t;
}

export interface Stadium {
  setTimeOfDay(mode: TimeOfDay): void;
  update(dt: number, excitement?: number): void; // excitement 0..1 makes the crowd bounce faster
}

export function buildStadium(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  { length: L, width: W }: Settings['pitch'],
  goal: Settings['goal'],
  teamColors: string[],
): Stadium {
  const M = 8; // grass beyond the lines
  const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const k = Math.min(1, L / 105); // marking scale for small pitches
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  // --- Pitch ---------------------------------------------------------------
  const PX = 28;
  const tw = Math.round((L + M * 2) * PX);
  const th = Math.round((W + M * 2) * PX);
  const grass = canvasTex(tw, th, (g) => {
    // mown stripes with per-pixel grain
    const img = g.createImageData(tw, th);
    const d = img.data;
    const stripes = 20;
    const sw = tw / stripes;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const light = Math.floor(x / sw) % 2 === 0;
        const n = (Math.random() - 0.5) * 18 + Math.sin(x * 0.013 + y * 0.007) * 4;
        const i = (y * tw + x) * 4;
        d[i] = (light ? 50 : 38) + n * 0.5;
        d[i + 1] = (light ? 112 : 90) + n;
        d[i + 2] = (light ? 44 : 34) + n * 0.4;
        d[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const X = (x: number) => (x + L / 2 + M) * PX;
    const Y = (z: number) => (z + W / 2 + M) * PX;
    // worn patches in the goalmouths and centre circle
    const wear = (cx: number, cy: number, r: number) => {
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      grd.addColorStop(0, 'rgba(120,105,60,0.35)');
      grd.addColorStop(1, 'rgba(120,105,60,0)');
      g.fillStyle = grd;
      g.fillRect(cx - r, cy - r, r * 2, r * 2);
    };
    wear(X(-L / 2 + 3), Y(0), 5 * PX);
    wear(X(L / 2 - 3), Y(0), 5 * PX);
    wear(X(0), Y(0), 4 * PX);

    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 0.12 * PX;
    g.strokeRect(X(-L / 2), Y(-W / 2), L * PX, W * PX);
    g.beginPath();
    g.moveTo(X(0), Y(-W / 2));
    g.lineTo(X(0), Y(W / 2));
    g.stroke();
    g.beginPath();
    g.arc(X(0), Y(0), 9.15 * k * PX, 0, Math.PI * 2);
    g.stroke();
    const dot = (x: number, z: number) => { g.beginPath(); g.arc(X(x), Y(z), 0.2 * PX, 0, Math.PI * 2); g.fill(); };
    dot(0, 0);
    const boxD = 16.5 * k, boxW = 40.3 * k, smallD = 5.5 * k, smallW = 18.3 * k, spot = 11 * k;
    for (const s of [-1, 1]) {
      const gx = s * L / 2;
      g.strokeRect(Math.min(X(gx), X(gx - s * boxD)), Y(-boxW / 2), boxD * PX, boxW * PX);
      g.strokeRect(Math.min(X(gx), X(gx - s * smallD)), Y(-smallW / 2), smallD * PX, smallW * PX);
      dot(gx - s * spot, 0);
      // the "D": the part of the penalty-spot circle outside the box
      const r = 9.15 * k;
      const a = Math.acos(Math.min(1, (boxD - spot) / r));
      g.beginPath();
      if (s > 0) g.arc(X(gx - s * spot), Y(0), r * PX, Math.PI - a, Math.PI + a);
      else g.arc(X(gx - s * spot), Y(0), r * PX, -a, a);
      g.stroke();
      for (const zs of [-1, 1]) {
        g.beginPath();
        g.arc(X(gx), Y(zs * W / 2), 1 * PX, 0, Math.PI * 2);
        g.stroke();
      }
    }
  });
  grass.anisotropy = maxAniso;
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + M * 2, W + M * 2), std({ map: grass, roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.receiveShadow = true;
  scene.add(pitch);

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(L + 120, W + 120), std({ color: '#24452a' }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = -0.02;
  apron.receiveShadow = true;
  scene.add(apron);

  // --- Goals ---------------------------------------------------------------
  const netTex = canvasTex(64, 64, (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(32, 0); g.lineTo(0, 32); g.lineTo(32, 64); g.lineTo(64, 32); g.closePath();
    g.stroke();
  });
  const postMat = std({ color: '#ffffff', roughness: 0.3 });
  const pr = 0.06;
  const depth = 2.0;
  const netMat = (rx: number, ry: number) => {
    const t = netTex.clone();
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.25, side: THREE.DoubleSide, roughness: 1 });
  };
  for (const s of [-1, 1]) {
    const grp = new THREE.Group();
    grp.position.x = s * L / 2;
    const cyl = (len: number, x: number, y: number, z: number, rot?: [number, number, number]) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, len, 10), postMat);
      m.position.set(x, y, z);
      if (rot) m.rotation.set(...rot);
      m.castShadow = true;
      grp.add(m);
    };
    for (const z of [-goal.width / 2, goal.width / 2]) {
      cyl(goal.height, 0, goal.height / 2, z);
      cyl(depth, s * depth / 2, 0.03, z, [0, 0, Math.PI / 2]); // ground stanchion
    }
    cyl(goal.width + pr * 2, 0, goal.height, 0, [Math.PI / 2, 0, 0]);
    // net: the roof slopes down toward the back
    const backH = goal.height * 0.55;
    const roofLen = Math.hypot(depth, goal.height - backH);
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(roofLen, goal.width), netMat(roofLen * 3, goal.width * 3));
    roof.rotation.set(Math.PI / 2, s * Math.atan2(goal.height - backH, depth), 0);
    roof.position.set(s * depth / 2, (goal.height + backH) / 2, 0);
    grp.add(roof);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(goal.width, backH), netMat(goal.width * 3, backH * 3));
    back.rotation.y = Math.PI / 2;
    back.position.set(s * depth, backH / 2, 0);
    grp.add(back);
    for (const z of [-goal.width / 2, goal.width / 2]) {
      const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(s * depth, 0), new THREE.Vector2(s * depth, backH), new THREE.Vector2(0, goal.height)]);
      const sg = new THREE.ShapeGeometry(shape);
      const uv = sg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 3);
      const side = new THREE.Mesh(sg, netMat(1, 1));
      side.position.z = z;
      grp.add(side);
    }
    scene.add(grp);
  }

  // corner flags
  const pole = new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6);
  const flagGeo = new THREE.PlaneGeometry(0.42, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = new THREE.Mesh(pole, postMat);
    p.position.set(sx * L / 2, 0.75, sz * W / 2);
    p.castShadow = true;
    scene.add(p);
    const f = new THREE.Mesh(flagGeo, std({ color: '#facc15', side: THREE.DoubleSide }));
    f.position.set(sx * L / 2 - sx * 0.21, 1.33, sz * W / 2);
    scene.add(f);
  }

  // --- LED advertising boards ---------------------------------------------
  const ads = [
    ['OKADA EXPRESS', '#1d4ed8'], ['YOKE SOLUTIONS', '#0f172a'], ['JOLLOF FC', '#b91c1c'], ['NAIJA BOOTS', '#047857'],
    ['ZOBO COLA', '#9d174d'], ['PUFF PUFF', '#a16207'], ['CHAPMAN', '#6d28d9'], ['SUYA SPOT', '#7c2d12'],
  ];
  const adTex = canvasTex(4096, 96, (g, w, h) => {
    const seg = w / ads.length;
    ads.forEach(([txt, col], i) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, col);
      grd.addColorStop(1, '#020617');
      g.fillStyle = grd;
      g.fillRect(i * seg, 0, seg, h);
      g.fillStyle = '#fff';
      g.font = '900 60px "Big Shoulders Display", "Arial Narrow", Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(txt, i * seg + seg / 2, h / 2 + 3);
    });
    g.fillStyle = 'rgba(0,0,0,0.25)'; // LED scanlines
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  });
  adTex.wrapS = THREE.RepeatWrapping;
  const boards: THREE.Texture[] = [];
  const boardH = 0.95;
  const frame = std({ color: '#0b0f19' });
  const addBoard = (len: number, x: number, z: number, ry: number) => {
    const t = adTex.clone();
    t.needsUpdate = true;
    t.repeat.set(len / 60, 1);
    const b = new THREE.Mesh(new THREE.BoxGeometry(len, boardH, 0.2), [
      frame, frame, frame, frame, new THREE.MeshBasicMaterial({ map: t }), frame,
    ]);
    b.position.set(x, boardH / 2, z);
    b.rotation.y = ry;
    b.castShadow = true;
    scene.add(b);
    boards.push(t);
  };
  const bz = W / 2 + 5, bx = L / 2 + 5.5;
  addBoard(L + 10, 0, -bz, 0);
  addBoard(W + 10, -bx, 0, Math.PI / 2);
  addBoard(W + 10, bx, 0, -Math.PI / 2);
  addBoard(L / 2 - 8, -L / 4 - 4, bz, Math.PI);
  addBoard(L / 2 - 8, L / 4 + 4, bz, Math.PI);

  // --- Stands ---------------------------------------------------------------
  const crowdColors = [...teamColors, ...teamColors, '#e5e7eb', '#cbd5e1', '#1f2937', '#111827', '#9a3412', '#fde68a'];
  const skins = ['#3b2417', '#5b3a26', '#7c5236', '#a87250', '#2f1d13'];
  // two frames of the same crowd; some fans are jumping in the second
  const crowdFrames = [0, 1].map((frameNo) =>
    canvasTex(512, 256, (g, w, h) => {
      g.fillStyle = '#1e293b';
      g.fillRect(0, 0, w, h);
      const rows = 16, cols = 64;
      const rh = h / rows, cw = w / cols;
      let seed = 1234;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let ry = 0; ry < rows; ry++) {
        g.fillStyle = '#334155';
        g.fillRect(0, ry * rh + rh - 3, w, 3);
        for (let cx = 0; cx < cols; cx++) {
          const empty = r() < 0.06;
          const jumps = r() < 0.45;
          const x = cx * cw + (r() - 0.5) * 2;
          const shirt = crowdColors[Math.floor(r() * crowdColors.length)];
          const skin = skins[Math.floor(r() * skins.length)];
          if (empty) continue;
          const y = ry * rh + (frameNo === 1 && jumps ? -3 : 0);
          g.fillStyle = shirt;
          g.fillRect(x + 1.5, y + 7, cw - 3, rh - 9);
          g.fillStyle = skin;
          g.beginPath();
          g.arc(x + cw / 2, y + 5, 2.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    })
  );
  const crowdMats: THREE.MeshStandardMaterial[] = [];
  const concrete = std({ color: '#475569' });
  const darkConcrete = std({ color: '#1e293b' });
  const roofMat = std({ color: '#0f172a', side: THREE.DoubleSide });
  const steel = std({ color: '#94a3b8', roughness: 0.5, metalness: 0.3 });

  // A stand: two sloped crowd tiers, front wall, roof with supports. Built facing +z, centred on x.
  const stand = (len: number, cx: number, cz: number, ry: number, roof = true) => {
    const grp = new THREE.Group();
    grp.position.set(cx, 0, cz);
    grp.rotation.y = ry;
    const tier = (z0: number, y0: number, depthT: number, rise: number) => {
      const slope = Math.hypot(depthT, rise);
      const frames = crowdFrames.map((f) => {
        const t = f.clone();
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(len / 26, slope / 13);
        t.needsUpdate = true;
        return t;
      });
      const m = std({ map: frames[0], roughness: 1 });
      m.userData.frames = frames;
      crowdMats.push(m);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(len, slope), m);
      plane.rotation.x = -Math.atan2(rise, depthT);
      plane.position.set(0, y0 + rise / 2, z0 - depthT / 2);
      grp.add(plane);
      const mass = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, slope), darkConcrete);
      mass.rotation.x = plane.rotation.x;
      mass.position.set(0, y0 + rise / 2 - 0.35, z0 - depthT / 2 - 0.15);
      grp.add(mass);
    };
    const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 2.2, 0.4), concrete);
    wall.position.set(0, 1.1, 0);
    grp.add(wall);
    tier(-0.2, 2.2, 14, 8);
    const mid = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 0.6), concrete);
    mid.position.set(0, 10.9, -14.6);
    grp.add(mid);
    tier(-15.2, 11.6, 13, 9);
    const back = new THREE.Mesh(new THREE.BoxGeometry(len, 24, 0.6), darkConcrete);
    back.position.set(0, 12, -28.6);
    grp.add(back);
    if (roof) {
      const rf = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.5, 26), roofMat);
      rf.position.set(0, 25.5, -13);
      rf.rotation.x = -0.06;
      grp.add(rf);
      const edge = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 1.2, 0.5), steel);
      edge.position.set(0, 26.2, 0);
      grp.add(edge);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len * 0.9, 0.25, 0.3), new THREE.MeshBasicMaterial({ color: '#fffbea' }));
      strip.position.set(0, 25.3, 0.2);
      grp.add(strip);
      for (let x = -len / 2 + 6; x < len / 2; x += 18) {
        const col = new THREE.Mesh(new THREE.BoxGeometry(0.5, 26, 0.5), steel);
        col.position.set(x, 13, -27.5);
        grp.add(col);
      }
    }
    scene.add(grp);
  };
  const sz = W / 2 + 9, sx = L / 2 + 10;
  stand(L + 16, 0, -sz, 0);
  stand(W + 16, -sx, 0, Math.PI / 2);
  stand(W + 16, sx, 0, -Math.PI / 2);
  // no stand on the camera side: it would block the near touchline
  // corner blocks so there are no holes behind the corner flags
  for (const cxs of [-1, 1]) for (const czs of [-1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), darkConcrete);
    c.position.set(cxs * (L / 2 + 25), 10, czs * (W / 2 + 25));
    scene.add(c);
  }

  // --- Floodlight towers ----------------------------------------------------
  const glowTex = canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,240,1)');
    grd.addColorStop(0.2, 'rgba(255,250,220,0.55)');
    grd.addColorStop(1, 'rgba(255,240,200,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
  const lampMat = new THREE.MeshBasicMaterial({ color: '#fffbea' });
  const glows: THREE.Object3D[] = [];
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const tx = x * (L / 2 + 22), tz = z * (W / 2 + 26);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 46, 8), steel);
    tower.position.set(tx, 23, tz);
    scene.add(tower);
    const bank = new THREE.Group();
    bank.position.set(tx, 46, tz);
    bank.lookAt(0, 0, 0);
    bank.add(new THREE.Mesh(new THREE.BoxGeometry(8, 5, 0.4), darkConcrete));
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.1, 0.2), lampMat);
      lamp.position.set(-2.85 + i * 1.9, -1.4 + j * 1.4, 0.25);
      bank.add(lamp);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    glows.push(glow);
    glow.scale.set(26, 26, 1);
    glow.position.set(0, 0, 1);
    bank.add(glow);
    scene.add(bank);
  }

  // --- Sky -------------------------------------------------------------------
  const skyTex = canvasTex(64, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#02040c');
    grd.addColorStop(0.42, '#0b1430');
    grd.addColorStop(0.5, '#1c2a52');
    grd.addColorStop(1, '#0b1020');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.7})`;
      g.fillRect(Math.random() * w, Math.random() * h * 0.4, 1, 1);
    }
  });
  // a daytime sky: deep blue overhead fading to a hazy horizon, with a few soft clouds
  const daySkyTex = canvasTex(256, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#2b6cd6');
    grd.addColorStop(0.38, '#6aa6ee');
    grd.addColorStop(0.5, '#cfe3f7');
    grd.addColorStop(1, '#9fb7c9');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w, y = h * (0.1 + Math.random() * 0.32), r = 10 + Math.random() * 26;
      const cg = g.createRadialGradient(x, y, 0, x, y, r);
      cg.addColorStop(0, 'rgba(255,255,255,0.55)');
      cg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = cg;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat));
  const fog = new THREE.Fog('#0b1430', 160, 380);
  scene.fog = fog;

  // --- Lights ----------------------------------------------------------------
  const hemi = new THREE.HemisphereLight('#dbe4ff', '#20361f', 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight('#fff6e0', 2.3);
  key.position.set(-30, 60, 28);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -L / 2 - 8;
  sc.right = L / 2 + 8;
  sc.top = W / 2 + 12;
  sc.bottom = -W / 2 - 12;
  sc.near = 10;
  sc.far = 160;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#c7d7ff', 0.9);
  fill.position.set(35, 40, -30);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffffff', 0.5);
  rim.position.set(0, 30, -60);
  scene.add(rim);

  let t = 0, frameT = 0, cur = 0;
  // 'day' (sunny afternoon) or 'night' (under floodlights)
  function setTimeOfDay(mode: TimeOfDay) {
    const day = mode !== 'night';
    skyMat.map = day ? daySkyTex : skyTex;
    skyMat.needsUpdate = true;
    fog.color.set(day ? '#b9cfe0' : '#0b1430');
    fog.near = day ? 220 : 160;
    fog.far = day ? 520 : 380;
    hemi.color.set(day ? '#e3efff' : '#dbe4ff');
    hemi.groundColor.set(day ? '#3c5a2c' : '#20361f');
    hemi.intensity = day ? 1.35 : 1.1;
    key.color.set(day ? '#fff1d6' : '#fff6e0');
    key.intensity = day ? 3.0 : 2.3;
    key.position.set(day ? -45 : -30, day ? 55 : 60, day ? 35 : 28); // a lower afternoon sun = longer shadows
    fill.intensity = day ? 0.55 : 0.9;
    rim.intensity = day ? 0.35 : 0.5;
    for (const g of glows) g.visible = !day;
    lampMat.color.set(day ? '#cbd5e1' : '#fffbea');
  }

  return {
    setTimeOfDay,
    // excitement 0..1 makes the crowd bounce faster
    update(dt, excitement = 0) {
      t += dt;
      for (const b of boards) b.offset.x = (t * 0.03) % 1;
      frameT += dt;
      if (frameT > (excitement > 0.5 ? 0.12 : 0.45)) {
        frameT = 0;
        cur = 1 - cur;
        for (const m of crowdMats) m.map = m.userData.frames[cur];
      }
    },
  };
}

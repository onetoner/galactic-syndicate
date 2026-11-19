// Galactic Syndicate – Test auf einem echten Android-Gerät über die WebView-DevTools (Chrome DevTools Protocol).
// Voraussetzung: Debug-APK läuft auf dem per USB angeschlossenen Gerät (USB-Debugging an).
// Aufruf (durch tablet-test.bat, Befehl "cdp"):  node scripts/tablet-cdp.mjs
// Ergebnis: .tablet/report.txt, .tablet/report.json, .tablet/c-*.jpg
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const ADB = process.env.ADB || 'adb';
const PKG = 'de.galacticsyndicate.game';
const PORT = 9333;
const OUT = '.tablet';
mkdirSync(OUT, { recursive: true });
const lines = [];
const report = { node: process.version, steps: [], console: [], info: {}, fps: {}, layout: {} };
const log = (...a) => { const s = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '); lines.push(s); console.log(s); };
const flush = () => { writeFileSync(`${OUT}/report.txt`, lines.join('\n') + '\n'); writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => { try { return execFileSync(ADB, args, { encoding: 'utf8', timeout: 30000 }).trim(); } catch (e) { return 'ADB-FEHLER: ' + String(e.message).split('\n')[0]; } };

async function getWebSocket() {
  if (typeof globalThis.WebSocket === 'function') return globalThis.WebSocket;
  const require = createRequire(import.meta.url);
  for (const m of ['ws', 'playwright-core/lib/utilsBundle']) { try { const x = require(m); const W = x.WebSocket || x.ws || x; if (typeof W === 'function') return W; } catch { /* nächster Versuch */ } }
  throw new Error('Kein WebSocket-Client verfügbar (Node ' + process.version + '). Node 22 oder neuer wird benötigt.');
}

async function connect() {
  let base = process.env.CDP_URL;
  if (!base) {
    const pid = adb('shell', 'pidof', PKG).split(/\s+/)[0];
    if (!/^\d+$/.test(pid)) throw new Error('App läuft nicht: ' + pid);
    log('App-PID', pid, '| forward:', adb('forward', `tcp:${PORT}`, `localabstract:webview_devtools_remote_${pid}`));
    base = `http://127.0.0.1:${PORT}`;
  }
  let targets = [];
  for (let i = 0; i < 20; i++) { try { targets = await (await fetch(base + '/json')).json(); if (targets.length) break; } catch { /* warten */ } await sleep(500); }
  const t = targets.find((x) => x.type === 'page' && /localhost|127\.0\.0\.1/.test(x.url)) || targets.find((x) => x.type === 'page');
  if (!t) throw new Error('Keine WebView-Seite gefunden: ' + JSON.stringify(targets).slice(0, 300));
  log('Seite:', t.url);
  const WS = await getWebSocket();
  const ws = new WS(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener ? (ws.addEventListener('open', res), ws.addEventListener('error', () => rej(new Error('WebSocket-Fehler')))) : (ws.on('open', res), ws.on('error', rej)); });
  let id = 0; const pending = new Map();
  const onMsg = (raw) => {
    const m = JSON.parse(typeof raw === 'string' ? raw : raw.data ?? raw.toString());
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) report.console.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 400));
    if (m.method === 'Runtime.exceptionThrown') report.console.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 600));
  };
  ws.addEventListener ? ws.addEventListener('message', onMsg) : ws.on('message', onMsg);
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pending.has(i)) { pending.delete(i); rej(new Error('Timeout ' + method)); } }, 30000); });
  await send('Runtime.enable'); await send('Page.enable');
  return { send, close: () => ws.close() };
}

const cdp = await connect().catch((e) => { log('VERBINDUNG FEHLGESCHLAGEN:', e.message); flush(); process.exit(2); });
const ev = async (expr) => {
  const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300));
  return r.result.value;
};
const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: Math.round(p[0]), y: Math.round(p[1]), id: i, radiusX: 8, radiusY: 8, force: 1 })) });
const tapXY = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []); await sleep(280); };
const drag = async (a, b, steps = 12, ms = 350) => { await touch('touchStart', [a]); for (let i = 1; i <= steps; i++) { await sleep(ms / steps); await touch('touchMove', [[a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps]]); } await touch('touchEnd', []); await sleep(300); };
const pinch = async (c, d0, d1, rot = 0, steps = 14) => {
  const pts = (d, ang) => [[c[0] - Math.cos(ang) * d, c[1] - Math.sin(ang) * d], [c[0] + Math.cos(ang) * d, c[1] + Math.sin(ang) * d]];
  await touch('touchStart', pts(d0, 0)); for (let i = 1; i <= steps; i++) { await sleep(30); await touch('touchMove', pts(d0 + ((d1 - d0) * i) / steps, (rot * i) / steps)); } await touch('touchEnd', []); await sleep(350);
};
const rect = (testid) => ev(`const e = document.querySelector('[data-testid="${testid}"]'); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await new Promise(r => setTimeout(r, 80)); const r = e.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const t = document.elementFromPoint(cx, cy); return { cx, cy, w: r.width, h: r.height, hit: !!t && (t === e || e.contains(t) || t.contains(e)), dis: e.getAttribute('aria-disabled') === 'true' || e.disabled === true };`);
const tap = async (testid, opt = {}) => {
  let r = null; for (let i = 0; i < 12 && !r; i++) { r = await rect(testid); if (!r) await sleep(250); }
  if (!r) throw new Error('Element fehlt: ' + testid);
  if (!r.hit && !opt.force) throw new Error(`Element verdeckt: ${testid} @${Math.round(r.cx)},${Math.round(r.cy)}`);
  if (r.dis && !opt.allowDisabled) throw new Error('Element deaktiviert: ' + testid);
  await tapXY(r.cx, r.cy); return r;
};
const has = (testid) => ev(`return !!document.querySelector('[data-testid="${testid}"]');`);
const ui = () => ev(`const u = window.__gs.ui, s = u.s; return { device: u.device, coarse: u.coarse, scale: u.effScale, screen: s.screen, left: s.leftPanel, right: s.rightOpen, placing: s.placing, demolish: s.demolish, pause: s.pauseOpen, sel: s.selectedBuildingId, view: s.view, sys: s.selectedSystemId };`);
const tick = (n) => ev(`const g = window.__gs.game; g.tick(${n}); window.__gs.ui.invalidate?.();`);
const shot = async (name) => {
  if (!process.env.CDP_URL) { try { const png = execFileSync(ADB, ['exec-out', 'screencap', '-p'], { timeout: 20000, maxBuffer: 64 * 1024 * 1024 }); if (png.length > 1000) { writeFileSync(`${OUT}/c-${name}.png`, png); return; } } catch { /* Ersatz unten */ } }
  try { const r = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 62 }); writeFileSync(`${OUT}/c-${name}.jpg`, Buffer.from(r.data, 'base64')); } catch (e) { log('  (Screenshot ' + name + ' fehlgeschlagen: ' + e.message + ')'); } };
const stats = async (waitMs = 3500) => { await sleep(waitMs); return ev(`const s = window.__gs.world.getStats(); return { fps: Math.round(s.fps), calls: s.drawCalls, tris: s.triangles };`); };
let fails = 0;
const step = async (name, fn) => { const t0 = Date.now(); try { const r = await fn(); report.steps.push({ name, ok: true, r }); log('  ok  ', name, r !== undefined ? '→ ' + JSON.stringify(r) : '', `(${Date.now() - t0} ms)`); } catch (e) { fails++; report.steps.push({ name, ok: false, err: e.message }); log('  FAIL', name, '→', e.message); await shot('fail-' + name.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)); } flush(); };

// Layout-Prüfung im Seitenkontext (identisch zur Headless-Prüfung)
const CHECK = `
  const W = window.innerWidth, H = window.innerHeight; const root = document.querySelector('#ui-root'); const coarse = root.dataset.coarse === '1';
  const res = { out: [], hover: [], overlap: [], small: [], targets: 0 };
  const name = (e) => e.dataset.testid || (typeof e.className === 'string' ? e.className.split(' ').slice(0, 2).join('.') : e.tagName);
  const box = (e) => { const r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return null; const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return null; let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) { const pc = getComputedStyle(p); if (pc.display === 'none' || pc.visibility === 'hidden') return null; if (pc.overflowX !== 'visible' || pc.overflowY !== 'visible') { const pr = p.getBoundingClientRect(); x0 = Math.max(x0, pr.left); y0 = Math.max(y0, pr.top); x1 = Math.min(x1, pr.right); y1 = Math.min(y1, pr.bottom); } }
    if (x1 - x0 < 1 || y1 - y0 < 1) return null; return { r, x0, y0, x1, y1 }; };
  const fmt = (b) => '[' + [b.x0, b.y0, b.x1, b.y1].map(Math.round).join(',') + ']';
  for (const e of root.querySelectorAll('.glass, .dialog, .right-col, .menu-nav, .logo, .sheet-bar, button, select, input:not([type=file]), textarea')) { const b = box(e); if (!b) continue; if (b.x1 > W + 1 || b.y1 > H + 1 || b.x0 < -1 || b.y0 < -1) res.out.push(name(e) + ' ' + fmt(b)); }
  const se = document.scrollingElement; if (se.scrollWidth > W + 1 || se.scrollHeight > H + 1) res.hover.push('seite ' + se.scrollWidth + 'x' + se.scrollHeight);
  const modal = root.querySelector('.overlay, .menu-dialog');
  if (!modal) { const blocks = [...root.querySelectorAll('.topbar, .rail, .region-left > .panel, .right-col, .log, .btn-job, .mode-hint, .help, .banner')].map((e) => [e, box(e)]).filter((x) => x[1]);
    for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) { const a = blocks[i][1], b = blocks[j][1]; const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); if (ox > 2 && oy > 2) res.overlap.push(name(blocks[i][0]) + ' × ' + name(blocks[j][0]) + ' (' + Math.round(ox) + '×' + Math.round(oy) + ')'); } }
  if (coarse) for (const e of root.querySelectorAll('button, select, input:not([type=file]), textarea, [data-action]')) { const b = box(e); if (!b) continue; res.targets++; if (b.r.width < 39.5 || b.r.height < 39.5) res.small.push(name(e) + ' ' + Math.round(b.r.width) + '×' + Math.round(b.r.height)); }
  return res;`;
const layout = async (name) => { const r = await ev(CHECK); const bad = r.out.length + r.hover.length + r.overlap.length + r.small.length; report.layout[name] = r; if (bad) log('    Layout', name, JSON.stringify({ out: r.out.slice(0, 4), hover: r.hover.slice(0, 3), overlap: r.overlap.slice(0, 4), small: r.small.slice(0, 5) })); await shot(name); return bad; };

// Bildschirmposition eines Rasterfelds der Sektor-Szene (CSS-Pixel)
const tileXY = (x, y) => ev(`const w = window.__gs.world, sc = w.sector, cam = sc.camera, s = window.__gs.game.getActiveSector(); const v = cam.position.clone().set(${x} - (s.w - 1) / 2, 0, ${y} - (s.h - 1) / 2).project(cam); const c = document.getElementById('world').getBoundingClientRect(); const px = c.left + (v.x * 0.5 + 0.5) * c.width, py = c.top + (-v.y * 0.5 + 0.5) * c.height; const t = document.elementFromPoint(px, py); return { px, py, free: !!t && t.id === 'world' };`);
const camPos = (scene) => ev(`const c = window.__gs.world.${scene}.camera; return [c.position.x, c.position.y, c.position.z].map((v) => Math.round(v * 100) / 100);`);
const nBuild = () => ev(`return window.__gs.game.getActiveSector().buildings.length;`);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let innerMid = { x: 600, y: 380 };

log('==== Geräte-Test', new Date().toISOString(), 'Node', process.version, '====');
await step('Geräte-Infos', async () => {
  const i = await ev(`const g = window.__gs; const gl = document.getElementById('world').getContext('webgl2'); const d = gl && gl.getExtension('WEBGL_debug_renderer_info'); const rep = g.world.getAssetReport(); return { inner: [innerWidth, innerHeight], dpr: devicePixelRatio, ua: navigator.userAgent.slice(0, 140), world: g.world.constructor.name, mode: g.world.getMode(), gpu: d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a', models: Object.values(rep.models).reduce((a, v) => (a[v] = (a[v] || 0) + 1, a), {}), device: g.ui.device, coarse: g.ui.coarse, uiScale: g.ui.effScale, preset: g.settings.get().graphics.preset, shadows: g.settings.get().graphics.shadowQuality, version: document.querySelector('[data-testid="version"]')?.textContent };`);
  report.info = i; innerMid = { x: i.inner[0] / 2, y: i.inner[1] / 2 + 20 }; return i;
});
await step('Menü: Layout + FPS', async () => { const bad = await layout('menu'); report.fps.menu = await stats(); return { layoutFehler: bad, ...report.fps.menu }; });
await step('Neues Spiel per Tippen', async () => { if ((await ui()).screen !== 'menu') return 'läuft schon'; await tap('menu-new'); await layout('menu-new'); await tap('new-start'); await sleep(2500); const u = await ui(); if (u.screen !== 'game') throw new Error('screen=' + u.screen); return u; });
await step('HUD-Layout + FPS im Sektor', async () => { const bad = await layout('hud-start'); report.fps.sector = await stats(); return { layoutFehler: bad, ...report.fps.sector }; });
await step('Bau-Modus: Tippen in die 3D-Welt platziert einen Topf', async () => {
  if ((await ui()).left !== 'build') await tap('nav-build');
  await tap('build-pot'); await sleep(400); const u = await ui(); if (u.placing !== 'pot') throw new Error('Bau-Modus nicht aktiv: ' + JSON.stringify(u));
  for (const id of ['place-rotate', 'cancel-modes']) if (!(await has(id))) throw new Error('Button fehlt: ' + id);
  const before = await nBuild(); let used = null;
  for (const [x, y] of [[2, 2], [3, 3], [1, 3], [3, 1], [2, 4], [4, 2]]) { const p = await tileXY(x, y); if (!p.free) continue; await tapXY(p.px, p.py); await sleep(350); if ((await nBuild()) > before) { used = { x, y, px: Math.round(p.px), py: Math.round(p.py) }; break; } }
  if (!used) throw new Error('kein Tipp hat platziert');
  const b = await ev(`const s = window.__gs.game.getActiveSector(); return s.buildings.map((b) => [b.type, b.x, b.y]);`);
  if (!b.some((q) => q[1] === used.x && q[2] === used.y)) throw new Error('Topf steht woanders: ' + JSON.stringify(b) + ' erwartet ' + JSON.stringify(used));
  report.pot = used; await layout('placing'); return { used, gebäude: b };
});
await step('Ziehen im Bau-Modus platziert nichts und schwenkt die Kamera', async () => {
  const n0 = await nBuild(), c0 = await camPos('sector'); const p = await tileXY(4, 4); await drag([p.px, p.py], [p.px - 160, p.py - 90]); const c1 = await camPos('sector'); const n1 = await nBuild();
  await drag([p.px - 160, p.py - 90], [p.px, p.py]);
  if (n1 !== n0) throw new Error('Ziehen hat gebaut'); const d = dist(c0, c1); if (d < 0.3) throw new Error('Kamera unbewegt: ' + d); return { kameraWeg: Math.round(d * 100) / 100 };
});
await step('Pinch zoomt, Twist dreht, kein Gebäude entsteht', async () => {
  const n0 = await nBuild(), c0 = await camPos('sector'); const c = await tileXY(3, 3);
  await pinch([c.px, c.py], 60, 150); const c1 = await camPos('sector'); await pinch([c.px, c.py], 150, 60); const c2 = await camPos('sector');
  await pinch([c.px, c.py], 100, 100, 0.7); const c3 = await camPos('sector'); await pinch([c.px, c.py], 100, 100, -0.7);
  if ((await nBuild()) !== n0) throw new Error('Pinch hat gebaut'); const zin = dist(c0, c1), zout = dist(c1, c2), tw = dist(c2, c3);
  if (zin < 0.2) throw new Error('Zoom wirkungslos: ' + zin); return { zoomRein: +zin.toFixed(2), zoomRaus: +zout.toFixed(2), twist: +tw.toFixed(2) };
});
await step('Zweiter Topf über die Rasterkarte, Drehen-Button, Abbrechen', async () => {
  const vis = async (id) => { const r = await rect(id); return !!r && r.w > 0 && r.h > 0 && r.hit; }; if (!(await vis('tile-0-0')) && (await vis('right-toggle'))) await tap('right-toggle');
  const n0 = await nBuild(); const free = report.pot && report.pot.x === 3 && report.pot.y === 2 ? 'tile-4-2' : 'tile-3-2'; await tap(free); await sleep(300);
  if ((await nBuild()) !== n0 + 1) throw new Error('Karte hat nicht platziert'); report.pot2 = free; await tap('place-rotate'); await tap('cancel-modes'); const u = await ui(); if (u.placing) throw new Error('Bau-Modus noch aktiv'); return { karte: free };
});
await step('Tippen auf den Topf in der 3D-Welt öffnet den Inspektor', async () => {
  const p = await tileXY(report.pot.x, report.pot.y); await tapXY(p.px, p.py); await sleep(400); const u = await ui(); if (!u.sel) throw new Error('nichts ausgewählt: ' + JSON.stringify(u));
  if (!(await has('plant-seed_neon'))) throw new Error('Pflanz-Button fehlt'); await layout('inspector-pot'); return { sel: u.sel };
});
await step('Pflanzen, gießen, vorspulen, ernten (alles per Tippen)', async () => {
  await tap('plant-seed_neon'); await tap('water'); await tap(report.pot2); await tap('plant-seed_neon'); await tap('water');
  await tick(400); await tap('water'); const p = await tileXY(report.pot.x, report.pot.y); await tapXY(p.px, p.py); await tap('water'); await tick(700); await sleep(900);
  await shot('ripe'); await tap('harvest'); await tap(report.pot2); await tap('harvest'); await sleep(300);
  const raw = await ev(`return window.__gs.game.inventoryList().filter((e) => e.category === 'raw').reduce((a, e) => a + e.count, 0);`); if (!(raw > 0)) throw new Error('keine Rohware'); return { rohware: raw };
});
for (const [nav, name] of [['nav-market', 'market'], ['nav-fleet', 'fleet'], ['nav-systems', 'systems'], ['nav-syndicates', 'syndicates']]) {
  await step('Panel ' + name + ': öffnet, Layout ok', async () => { await tap(nav); await sleep(350); const u = await ui(); const bad = await layout('panel-' + name); return { left: u.left, layoutFehler: bad }; });
}
await step('Planet-Ansicht: Layout, FPS, Ziehen dreht', async () => { await tap('view-planet'); await sleep(1500); const bad = await layout('planet'); const c0 = await camPos('planet'); await drag([innerMid.x, innerMid.y], [innerMid.x - 150, innerMid.y + 30]); const c1 = await camPos('planet'); report.fps.planet = await stats(2500); return { layoutFehler: bad, kameraWeg: +dist(c0, c1).toFixed(2), ...report.fps.planet }; });
await step('Galaxie-Ansicht: Layout, FPS, Ziehen, Pinch, System antippen', async () => {
  await tap('view-galaxy'); await sleep(1800); const bad = await layout('galaxy'); const c0 = await camPos('galaxy'); await drag([innerMid.x, innerMid.y], [innerMid.x - 140, innerMid.y - 40]); const c1 = await camPos('galaxy'); await pinch([innerMid.x, innerMid.y], 70, 140); const c2 = await camPos('galaxy');
  const sys = await ev(`const w = window.__gs.world, cam = w.galaxy.camera, c = document.getElementById('world').getBoundingClientRect(); const out = []; for (const n of window.__gs.game.getGalaxyView()) { if (n.id === 'sol') continue; const v = cam.position.clone().set(n.pos.x, n.pos.y, n.pos.z).project(cam); const px = c.left + (v.x * .5 + .5) * c.width, py = c.top + (-v.y * .5 + .5) * c.height; const t = document.elementFromPoint(px, py); if (v.z < 1 && t && t.id === 'world') out.push({ id: n.id, px, py }); } return out.slice(0, 3);`);
  let picked = null; for (const s of sys) { await tapXY(s.px, s.py); await sleep(500); const u = await ui(); if (u.sys) { picked = { soll: s.id, ist: u.sys }; break; } }
  report.fps.galaxy = await stats(2500); await layout('galaxy-system'); if (!picked) throw new Error('kein System per Tippen gewählt (Kandidaten: ' + sys.length + ')');
  return { layoutFehler: bad, schwenk: +dist(c0, c1).toFixed(2), zoom: +dist(c1, c2).toFixed(2), system: picked, ...report.fps.galaxy };
});
await step('Zurück-Taste (Android) schließt Panel bzw. öffnet das Pausemenü', async () => {
  await tap('view-sector'); await sleep(800); const seq = [];
  await tap('nav-market'); await sleep(300); for (let i = 0; i < 5; i++) { if (await has('pause-dialog-settings')) break; adb('shell', 'input', 'keyevent', 'KEYCODE_BACK'); await sleep(800); const u = await ui(); seq.push({ left: u.left, pause: u.pause, sys: u.sys, sichtbar: await ev('return document.visibilityState;') }); }
  if (!(await has('pause-dialog-settings'))) throw new Error('Pausemenü nicht offen: ' + JSON.stringify(seq)); const bad = await layout('pause'); const alive = adb('shell', 'pidof', PKG); if (!/^\d+/.test(alive)) throw new Error('App beendet'); return { schritte: seq.length, layoutFehler: bad };
});
await step('Einstellungen: alle Tabs, Layout', async () => {
  await tap('pause-dialog-settings'); const res = {}; for (const t of ['graphics', 'audio', 'controls', 'gameplay']) { await tap('settings-tab-' + t); await sleep(250); res[t] = await layout('settings-' + t); }
  res.gesten = await has('touch-gestures'); await tap('settings-tab-gameplay'); await tap('settings-done'); if (await has('pause-resume')) await tap('pause-resume'); return res;
});
await step('Belastung: 12×12 Industrie-Sektor voll bebaut, FPS', async () => {
  const r = await ev(`const g = window.__gs.game, u = window.__gs.ui; g.addCredits(900000, 't'); g.addRevenue(900000, 'street'); const b = g.buySector('industrial'); if (!b.ok) return { err: b.reason }; const s = g.state.sectors[g.state.sectors.length - 1]; const types = ['pot', 'pot', 'pot', 'grow_lamp', 'auto_waterer', 'conveyor', 'synth_lab', 'packaging_line', 'storage_crate', 'auto_harvester', 'pot', 'workbench']; let n = 0; for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { if (g.placeBuilding(s.id, types[(x + y * 5) % types.length], x, y).ok) n++; } for (const bl of s.buildings) if (bl.type === 'pot') { g.plant(s.id, bl.id, 'seed_neon'); g.water(s.id, bl.id); } g.setActiveSector?.(s.id); u.invalidate?.(); return { sektor: s.id, gebäude: n, aktiv: g.state.activeSectorId };`);
  if (r.err) throw new Error(r.err); await ev(`const g = window.__gs; if (g.game.state.activeSectorId !== ${JSON.stringify(r.sektor)}) { g.game.state.activeSectorId = ${JSON.stringify(r.sektor)}; } g.world.setActiveSector(String(${JSON.stringify(r.sektor)})); g.ui.invalidate?.();`);
  await tick(600); const first = await stats(3000); report.fps.sector12 = await stats(9000); const perf = await ev(`const w = window.__gs.world; return { stufe: w.perfStage, schatten: w.renderer ? w.renderer.shadowMap.enabled : null, pixelRatio: w.pixelRatio };`); await layout('sector12'); return { ...r, zuerst: first, danach: report.fps.sector12, entlastung: perf };
});
await step('App in den Hintergrund und zurück: läuft weiter, kein Fehler', async () => {
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await sleep(4000); adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1'); await sleep(3500);
  const s = await stats(3000); const u = await ui(); await shot('resume'); if (!(s.fps > 0)) throw new Error('rendert nicht mehr: ' + JSON.stringify(s)); return { ...s, screen: u.screen };
});
await step('Speichern in Slot, Text-Export vorhanden', async () => { const r = await ev(`const g = window.__gs.game; const s = g.saveToSlot('tablet-test', 'Tablet-Test'); return { ok: s.ok, slots: g.listSlots().length, exportLen: g.exportSave().length };`); if (!r.ok) throw new Error('Speichern fehlgeschlagen'); return r; });

log(''); log('FPS:', report.fps); log('Konsolenmeldungen:', report.console.length, report.console.slice(0, 12));
log(`== Geräte-Test: ${report.steps.length} Schritte, fehlgeschlagen ${fails}`);
flush(); cdp.close(); if (!process.env.CDP_URL) adb('forward', '--remove', `tcp:${PORT}`);
process.exit(fails ? 1 : 0);

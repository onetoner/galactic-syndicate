import * as THREE from 'three';

/** Kleiner deterministischer Zufallsgenerator für prozedurale Deko (unabhängig von der Simulation). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D-Canvas nicht verfügbar');
  return { canvas, ctx };
}

function colorTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Weicher runder Leuchtpunkt (für Sterne, Partikel, Triebwerke). */
export function makeGlowTexture(size = 128, core = 0.12): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;
  const g = ctx.createRadialGradient(c, c, 0, c, c, c);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.07)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return colorTexture(canvas);
}

/** Ring-Textur (Auswahl-Marker). */
export function makeRingTexture(size = 128, thickness = 0.1): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size, size);
  const c = size / 2;
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.lineWidth = size * thickness;
  ctx.beginPath();
  ctx.arc(c, c, c - ctx.lineWidth, 0, Math.PI * 2);
  ctx.stroke();
  return colorTexture(canvas);
}

/** Warn-Symbol (Dreieck mit Ausrufezeichen) für trockene Töpfe. */
export function makeWarningTexture(size = 96): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#ff5a3c';
  ctx.strokeStyle = '#2a0a05';
  ctx.lineWidth = size * 0.06;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(size * 0.5, size * 0.1);
  ctx.lineTo(size * 0.92, size * 0.86);
  ctx.lineTo(size * 0.08, size * 0.86);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff4e8';
  ctx.fillRect(size * 0.455, size * 0.34, size * 0.09, size * 0.28);
  ctx.beginPath();
  ctx.arc(size * 0.5, size * 0.73, size * 0.055, 0, Math.PI * 2);
  ctx.fill();
  return colorTexture(canvas);
}

/** Weiche Nebel-Wolke (Galaxie-/Menü-Hintergrund). */
export function makeNebulaTexture(seed: number, size = 256): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(size, size);
  const rnd = mulberry(seed);
  for (let i = 0; i < 26; i++) {
    const x = size * (0.25 + rnd() * 0.5);
    const y = size * (0.25 + rnd() * 0.5);
    const r = size * (0.12 + rnd() * 0.26);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.09;
    g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return colorTexture(canvas);
}

/** Laufende Lichtstreifen für Förderbänder (in V-Richtung kachelbar). */
export function makeStripeTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(64, 64);
  ctx.clearRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (const y0 of [16, 48]) {
    ctx.beginPath();
    ctx.moveTo(14, y0 + 8);
    ctx.lineTo(32, y0 - 6);
    ctx.lineTo(50, y0 + 8);
    ctx.stroke();
  }
  const tex = colorTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export interface LabelSprite {
  sprite: THREE.Sprite;
  dispose(): void;
}

/** Text-Label als Sprite. `height` = Welt-Höhe des Labels. */
export function makeLabelSprite(text: string, color: string, height: number): LabelSprite {
  const fontPx = 44;
  const pad = 14;
  const probe = makeCanvas(8, 8).ctx;
  probe.font = `600 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
  const textW = Math.ceil(probe.measureText(text).width);
  const w = Math.max(64, textW + pad * 2);
  const h = fontPx + pad * 2;
  const { canvas, ctx } = makeCanvas(w, h);
  ctx.font = `600 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(4,8,18,0.92)';
  ctx.strokeText(text, w / 2, h / 2 + 2);
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = colorTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, fog: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set((height * w) / h, height, 1);
  sprite.renderOrder = 20;
  return {
    sprite,
    dispose: () => {
      tex.dispose();
      mat.dispose();
    },
  };
}

export function forEachMesh(root: THREE.Object3D, fn: (mesh: THREE.Mesh) => void): void {
  root.traverse((o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh) fn(o);
  });
}

export function forEachMaterial(root: THREE.Object3D, fn: (mat: THREE.Material) => void): void {
  root.traverse((o: THREE.Object3D) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line || o instanceof THREE.Points) {
      const m: THREE.Material | THREE.Material[] = o.material;
      if (Array.isArray(m)) m.forEach(fn);
      else fn(m);
    } else if (o instanceof THREE.Sprite) {
      fn(o.material);
    }
  });
}

/** Ersetzt alle Mesh-Materialien eines Objekts durch ein gemeinsames Material (z. B. Bau-Vorschau). */
export function overrideMaterial(root: THREE.Object3D, mat: THREE.Material): void {
  forEachMesh(root, (mesh) => {
    mesh.material = mat;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
  });
}

export function setShadowFlags(root: THREE.Object3D, cast: boolean, receive: boolean): void {
  forEachMesh(root, (mesh) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
  });
}

/** Markiert alle Materialien neu (nötig, wenn Schatten global an-/ausgeschaltet werden). */
export function markMaterialsDirty(root: THREE.Object3D): void {
  forEachMaterial(root, (m) => {
    m.needsUpdate = true;
  });
}

/**
 * Sammelt Geometrien, Materialien und Texturen, die eine Szene selbst erzeugt hat, und gibt sie gesammelt frei.
 * Geteilte Ressourcen (AssetLoader, Erd-Texturen) werden NICHT hier registriert.
 */
export class Disposer {
  private items = new Set<{ dispose(): void }>();

  track<T extends { dispose(): void }>(item: T): T {
    this.items.add(item);
    return item;
  }

  release(item: { dispose(): void }): void {
    if (this.items.delete(item)) item.dispose();
  }

  dispose(): void {
    this.items.forEach((i) => {
      try {
        i.dispose();
      } catch {
        /* bereits freigegeben */
      }
    });
    this.items.clear();
  }
}

/** Sternenfeld als Punktwolke auf einer Kugelschale. */
export function makeStarfield(d: Disposer, count: number, radius: number, seed: number, sprite: THREE.Texture): THREE.Points {
  const rnd = mulberry(seed);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const u = rnd() * 2 - 1;
    const phi = rnd() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = radius * (0.85 + rnd() * 0.15);
    pos[i * 3] = r * s * Math.cos(phi);
    pos[i * 3 + 1] = r * u;
    pos[i * 3 + 2] = r * s * Math.sin(phi);
    const tint = rnd();
    const b = 0.35 + rnd() * 0.65;
    if (tint < 0.15) c.setRGB(0.7 * b, 0.82 * b, 1 * b);
    else if (tint < 0.28) c.setRGB(1 * b, 0.82 * b, 0.62 * b);
    else c.setRGB(b, b, b);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  const geo = d.track(new THREE.BufferGeometry());
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = d.track(
    new THREE.PointsMaterial({
      map: sprite, size: radius * 0.012, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: 0.95,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }),
  );
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = -10;
  return points;
}

/** true, wenn gerade ein Eingabefeld den Fokus hat (dann keine Tastatur-Steuerung der Kamera). */
export function isTypingTarget(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

export const TAU = Math.PI * 2;

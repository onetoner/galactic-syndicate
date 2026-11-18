import * as THREE from 'three';
import { makeCanvas } from './util';

// ---------------------------------------------------------------- Rauschen (nahtlos auf der Kugel)

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let xf = x - xi;
  let yf = y - yi;
  let zf = z - zi;
  xf = xf * xf * (3 - 2 * xf);
  yf = yf * yf * (3 - 2 * yf);
  zf = zf * zf * (3 - 2 * zf);
  const a = hash3(xi, yi, zi, seed);
  const b = hash3(xi + 1, yi, zi, seed);
  const c = hash3(xi, yi + 1, zi, seed);
  const d = hash3(xi + 1, yi + 1, zi, seed);
  const e = hash3(xi, yi, zi + 1, seed);
  const f = hash3(xi + 1, yi, zi + 1, seed);
  const g = hash3(xi, yi + 1, zi + 1, seed);
  const h = hash3(xi + 1, yi + 1, zi + 1, seed);
  const x0 = a + (b - a) * xf;
  const x1 = c + (d - c) * xf;
  const x2 = e + (f - e) * xf;
  const x3 = g + (h - g) * xf;
  const y0 = x0 + (x1 - x0) * yf;
  const y1 = x2 + (x3 - x2) * yf;
  return y0 + (y1 - y0) * zf;
}

function fbm(x: number, y: number, z: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += vnoise(x * freq, y * freq, z * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const sat = (v: number): number => Math.min(1, Math.max(0, v));

/** Breiten-/Längengrad → Punkt auf der Einheitskugel (passend zur UV-Abwicklung von SphereGeometry). */
export function latLonToVector(lat: number, lon: number, radius: number, target: THREE.Vector3): THREE.Vector3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return target.set(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
}

/** true, wenn an dieser Stelle der prozeduralen Erde eisfreies Festland liegt (gleiche Formel wie die Textur). */
export function isLand(lat: number, lon: number): boolean {
  if (Math.abs(lat) > 58) return false;
  const p = latLonToVector(lat, lon, 1, new THREE.Vector3());
  const elev = fbm(p.x * 1.7 + 11, p.y * 1.7 + 5, p.z * 1.7 + 3, 6, 1234);
  const detail = fbm(p.x * 6 + 2, p.y * 6 + 9, p.z * 6 + 4, 3, 77);
  return elev + (detail - 0.5) * 0.08 >= 0.535;
}

/** Verschiebt einen Punkt rein optisch auf das nächstgelegene Festland (Sektor-Marker sollen nicht im Ozean stehen). */
export function snapToLand(lat: number, lon: number): { lat: number; lon: number } {
  const la = Math.max(-56, Math.min(56, lat));
  if (isLand(la, lon)) return { lat: la, lon };
  for (let r = 3; r <= 60; r += 3) {
    const steps = Math.max(8, Math.round(r * 0.8));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const tl = la + Math.sin(a) * r;
      const to = lon + (Math.cos(a) * r) / Math.max(0.35, Math.cos((la * Math.PI) / 180));
      if (isLand(tl, to)) return { lat: tl, lon: to };
    }
  }
  return { lat: la, lon };
}

function buildSurface(w: number, h: number): { day: HTMLCanvasElement; night: HTMLCanvasElement } {
  const day = makeCanvas(w, h);
  const night = makeCanvas(w, h);
  const dImg = day.ctx.createImageData(w, h);
  const nImg = night.ctx.createImageData(w, h);
  const dd = dImg.data;
  const nd = nImg.data;
  const p = new THREE.Vector3();
  for (let py = 0; py < h; py++) {
    const lat = 90 - ((py + 0.5) / h) * 180;
    const absLat = Math.abs(lat);
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w) * 360 - 180;
      latLonToVector(lat, lon, 1, p);
      const elev = fbm(p.x * 1.7 + 11, p.y * 1.7 + 5, p.z * 1.7 + 3, 6, 1234);
      const detail = fbm(p.x * 6 + 2, p.y * 6 + 9, p.z * 6 + 4, 3, 77);
      const land = elev + (detail - 0.5) * 0.08;
      const i = (py * w + px) * 4;
      let r: number;
      let g: number;
      let b: number;
      let light = 0;
      const iceLine = 66 + (detail - 0.5) * 24;
      if (absLat > iceLine + 8) {
        r = 0.86; g = 0.9; b = 0.94;
      } else if (land < 0.52) {
        const depth = sat(land / 0.52);
        const shallow = sat((depth - 0.82) / 0.18);
        r = lerp(0.015, 0.05, depth) + shallow * 0.05;
        g = lerp(0.05, 0.2, depth) + shallow * 0.16;
        b = lerp(0.16, 0.42, depth) + shallow * 0.12;
      } else {
        const hgt = sat((land - 0.52) / 0.3);
        const dry = sat(fbm(p.x * 3 + 40, p.y * 3 + 12, p.z * 3 + 8, 3, 555) * 1.6 - 0.35 + (1 - absLat / 45) * 0.25);
        r = lerp(0.1, 0.5, dry);
        g = lerp(0.3, 0.4, dry);
        b = lerp(0.1, 0.2, dry);
        const rock = sat((hgt - 0.5) / 0.4);
        r = lerp(r, 0.42, rock);
        g = lerp(g, 0.38, rock);
        b = lerp(b, 0.34, rock);
        if (absLat > iceLine) {
          const t = sat((absLat - iceLine) / 8);
          r = lerp(r, 0.86, t); g = lerp(g, 0.9, t); b = lerp(b, 0.94, t);
        }
        // Stadtlichter: Ballungsräume in gemäßigten Breiten, bevorzugt im Flachland
        if (absLat < 62) {
          const city = fbm(p.x * 9 + 70, p.y * 9 + 31, p.z * 9 + 17, 3, 909);
          const sparkle = hash3(px, py, 7, 4242);
          const dens = sat((city - 0.52) * 5) * (1 - rock) * (0.35 + dry * 0.4 + 0.3);
          if (sparkle < dens * 0.55) light = 0.55 + sparkle * 0.9;
        }
      }
      dd[i] = Math.round(sat(r) * 255);
      dd[i + 1] = Math.round(sat(g) * 255);
      dd[i + 2] = Math.round(sat(b) * 255);
      dd[i + 3] = 255;
      const l = sat(light);
      nd[i] = Math.round(l * 255);
      nd[i + 1] = Math.round(l * 205);
      nd[i + 2] = Math.round(l * 120);
      nd[i + 3] = 255;
    }
  }
  day.ctx.putImageData(dImg, 0, 0);
  night.ctx.putImageData(nImg, 0, 0);
  return { day: day.canvas, night: night.canvas };
}

function buildClouds(w: number, h: number): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const p = new THREE.Vector3();
  for (let py = 0; py < h; py++) {
    const lat = 90 - ((py + 0.5) / h) * 180;
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w) * 360 - 180;
      latLonToVector(lat, lon, 1, p);
      const n = fbm(p.x * 3.2 + 90, p.y * 5.5 + 20, p.z * 3.2 + 60, 5, 31337);
      const a = sat((n - 0.5) * 3.2);
      const i = (py * w + px) * 4;
      d[i] = 255;
      d[i + 1] = 255;
      d[i + 2] = 255;
      d[i + 3] = Math.round(a * 210);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

const ATMO_VERTEX = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const ATMO_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uPower;
uniform float uGain;
uniform float uInvert;
varying vec3 vN;
varying vec3 vV;
void main() {
  float d = abs(dot(normalize(vN), normalize(vV)));
  d = mix(d, 1.0 - d, uInvert);
  float f = clamp(pow(d, uPower) * uGain, 0.0, 1.0);
  gl_FragColor = vec4(uColor, f);
}`;

export interface EarthObject {
  /** Wurzel (auf den Radius skaliert) */
  root: THREE.Group;
  /** rotierender Teil (Kugel + Wolken); Marker hier in Einheitskugel-Koordinaten anhängen */
  spin: THREE.Group;
  clouds: THREE.Mesh;
}

/** Erzeugt die prozedurale Erde. Texturen/Materialien werden einmal gebaut und zwischen Menü- und Planeten-Szene geteilt. */
export class EarthFactory {
  private geo: THREE.SphereGeometry | null = null;
  private surface: THREE.MeshStandardMaterial | null = null;
  private cloudMat: THREE.MeshStandardMaterial | null = null;
  private halo: THREE.ShaderMaterial | null = null;
  private rim: THREE.ShaderMaterial | null = null;
  private textures: THREE.Texture[] = [];

  private ensure(): void {
    if (this.geo) return;
    this.geo = new THREE.SphereGeometry(1, 64, 40);
    const { day, night } = buildSurface(720, 360);
    const dayTex = new THREE.CanvasTexture(day);
    dayTex.colorSpace = THREE.SRGBColorSpace;
    const nightTex = new THREE.CanvasTexture(night);
    nightTex.colorSpace = THREE.SRGBColorSpace;
    const cloudTex = new THREE.CanvasTexture(buildClouds(512, 256));
    cloudTex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(dayTex, nightTex, cloudTex);
    this.surface = new THREE.MeshStandardMaterial({
      map: dayTex, roughness: 0.85, metalness: 0, emissive: 0xffffff, emissiveMap: nightTex, emissiveIntensity: 1.6, fog: false,
    });
    this.surface.envMapIntensity = 0;
    this.cloudMat = new THREE.MeshStandardMaterial({ map: cloudTex, transparent: true, opacity: 0.85, roughness: 1, metalness: 0, depthWrite: false, fog: false });
    this.cloudMat.envMapIntensity = 0;
    const atmo = (invert: number, power: number, gain: number, side: THREE.Side): THREE.ShaderMaterial =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(0x4fb8ff) },
          uPower: { value: power },
          uGain: { value: gain },
          uInvert: { value: invert },
        },
        vertexShader: ATMO_VERTEX,
        fragmentShader: ATMO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side,
      });
    // Halo außerhalb der Kugel (Rückseiten einer größeren Schale) + Randschimmer auf der Kugel
    this.halo = atmo(0, 2.6, 1.9, THREE.BackSide);
    this.rim = atmo(1, 3.0, 0.9, THREE.FrontSide);
  }

  create(radius: number): EarthObject {
    this.ensure();
    const geo = this.geo!;
    const root = new THREE.Group();
    root.scale.setScalar(radius);
    const spin = new THREE.Group();
    const globe = new THREE.Mesh(geo, this.surface!);
    const clouds = new THREE.Mesh(geo, this.cloudMat!);
    clouds.scale.setScalar(1.012);
    spin.add(globe, clouds);
    const rim = new THREE.Mesh(geo, this.rim!);
    rim.scale.setScalar(1.02);
    const halo = new THREE.Mesh(geo, this.halo!);
    halo.scale.setScalar(1.16);
    root.add(spin, rim, halo);
    return { root, spin, clouds };
  }

  dispose(): void {
    this.geo?.dispose();
    this.surface?.dispose();
    this.cloudMat?.dispose();
    this.halo?.dispose();
    this.rim?.dispose();
    this.textures.forEach((t) => t.dispose());
    this.textures = [];
    this.geo = null;
  }
}

import * as THREE from 'three';
import { isTypingTarget } from './util';

/** Geteilter Eingabezustand (wird von ThreeWorldView gepflegt). */
export interface InputState {
  /** aktuell gedrückte Tasten (KeyboardEvent.code) */
  keys: Set<string>;
  /** Zeiger in Canvas-Pixeln; inside = Zeiger ist über dem Canvas */
  px: number;
  py: number;
  inside: boolean;
  width: number;
  height: number;
}

export interface ControlOptions {
  cameraSpeed: number;
  zoomSensitivity: number;
  edgeScrolling: boolean;
  invertMouse: boolean;
}

export const DEFAULT_CONTROLS: ControlOptions = { cameraSpeed: 1, zoomSensitivity: 1, edgeScrolling: true, invertMouse: false };

const clamp = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v));

function axis(keys: Set<string>, pos: string[], neg: string[]): number {
  let v = 0;
  for (const k of pos) if (keys.has(k)) v = 1;
  for (const k of neg) if (keys.has(k)) v -= 1;
  return clamp(v, -1, 1);
}

/**
 * Kamera, die um einen Zielpunkt kreist (Gier/Neigung/Abstand) – Basis für RTS- und Orbit-Steuerung.
 * Alle Werte werden weich nachgeführt.
 */
export class OrbitRig {
  readonly target = new THREE.Vector3();
  yaw = 0;
  pitch = 0.9;
  distance = 14;
  minDistance = 3;
  maxDistance = 60;
  minPitch = 0.25;
  maxPitch = 1.45;
  /** Begrenzung des Zielpunkts (Halbachsen um `center`), 0 = unbegrenzt */
  boundX = 0;
  boundZ = 0;
  readonly center = new THREE.Vector3();
  /** Schwenken per Tastatur/Rand erlaubt */
  panEnabled = true;
  /** Zielpunkt darf die XZ-Ebene verlassen (Galaxie) */
  options: ControlOptions = { ...DEFAULT_CONTROLS };

  private curTarget = new THREE.Vector3();
  private curYaw = 0;
  private curPitch = 0.9;
  private curDistance = 14;
  private focusTarget: THREE.Vector3 | null = null;
  private tmp = new THREE.Vector3();

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /** Setzt die Kamera hart (ohne Nachführen) auf die aktuellen Zielwerte. */
  snap(): void {
    this.curTarget.copy(this.target);
    this.curYaw = this.yaw;
    this.curPitch = this.pitch;
    this.curDistance = this.distance;
    this.apply();
  }

  /** Fährt den Zielpunkt weich an. */
  focus(point: THREE.Vector3, distance?: number): void {
    this.focusTarget = point.clone();
    if (distance !== undefined) this.distance = clamp(distance, this.minDistance, this.maxDistance);
  }

  rotate(dxPixels: number, dyPixels: number): void {
    const inv = this.options.invertMouse ? -1 : 1;
    this.yaw -= dxPixels * 0.0055 * inv;
    this.pitch = clamp(this.pitch + dyPixels * 0.0045 * inv, this.minPitch, this.maxPitch);
  }

  /** Verschiebt den Zielpunkt in der Bodenebene relativ zur Blickrichtung (Pixel-Delta beim Ziehen). */
  dragPan(dxPixels: number, dyPixels: number): void {
    if (!this.panEnabled) return;
    const k = this.distance * 0.0016;
    this.moveLocal(-dxPixels * k, dyPixels * k);
    this.focusTarget = null;
  }

  zoom(wheelDelta: number): void {
    const steps = clamp(wheelDelta / 100, -4, 4);
    this.distance = clamp(this.distance * Math.pow(1.12, steps * this.options.zoomSensitivity), this.minDistance, this.maxDistance);
  }

  /** rechts/vorwärts relativ zur Kamera-Gierung */
  private moveLocal(right: number, forward: number): void {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    // Kamera steht bei yaw=0 auf +Z und blickt nach −Z: vorwärts = (−s, 0, −c), rechts = (c, 0, −s)
    this.target.x += right * c - forward * s;
    this.target.z += -right * s - forward * c;
    this.clampTarget();
  }

  private clampTarget(): void {
    if (this.boundX > 0) this.target.x = clamp(this.target.x, this.center.x - this.boundX, this.center.x + this.boundX);
    if (this.boundZ > 0) this.target.z = clamp(this.target.z, this.center.z - this.boundZ, this.center.z + this.boundZ);
  }

  update(dt: number, input: InputState | null): void {
    if (input && this.panEnabled) {
      let mx = 0;
      let mz = 0;
      let rot = 0;
      if (!isTypingTarget()) {
        mx = axis(input.keys, ['KeyD', 'ArrowRight'], ['KeyA', 'ArrowLeft']);
        mz = axis(input.keys, ['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
        rot = axis(input.keys, ['KeyE'], ['KeyQ']);
      }
      if (this.options.edgeScrolling && input.inside && mx === 0 && mz === 0) {
        const m = 14;
        if (input.px <= m) mx = -1;
        else if (input.px >= input.width - m) mx = 1;
        if (input.py <= m) mz = 1;
        else if (input.py >= input.height - m) mz = -1;
      }
      if (mx !== 0 || mz !== 0) {
        const speed = (4 + this.distance * 0.9) * this.options.cameraSpeed * dt;
        const len = Math.hypot(mx, mz) || 1;
        this.moveLocal((mx / len) * speed, (mz / len) * speed);
        this.focusTarget = null;
      }
      if (rot !== 0) this.yaw += rot * 1.6 * dt;
    }

    if (this.focusTarget) {
      this.target.lerp(this.focusTarget, 1 - Math.exp(-5 * dt));
      if (this.target.distanceToSquared(this.focusTarget) < 0.0004) {
        this.target.copy(this.focusTarget);
        this.focusTarget = null;
      }
    }

    const k = 1 - Math.exp(-12 * dt);
    this.curTarget.lerp(this.target, k);
    this.curYaw += (this.yaw - this.curYaw) * k;
    this.curPitch += (this.pitch - this.curPitch) * k;
    this.curDistance += (this.distance - this.curDistance) * k;
    this.apply();
  }

  private apply(): void {
    const cp = Math.cos(this.curPitch);
    this.tmp.set(Math.sin(this.curYaw) * cp, Math.sin(this.curPitch), Math.cos(this.curYaw) * cp).multiplyScalar(this.curDistance);
    this.camera.position.copy(this.curTarget).add(this.tmp);
    this.camera.lookAt(this.curTarget);
  }
}

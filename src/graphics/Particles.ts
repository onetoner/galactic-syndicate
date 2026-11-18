import * as THREE from 'three';

/**
 * Einfaches gepooltes Partikelsystem (eine Punktwolke, additive Leuchtpunkte).
 * Keine Allokationen pro Frame; `setCapacity(0)` schaltet es praktisch ab.
 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;
  private pos: Float32Array;
  private col: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private gravity: Float32Array;
  private readonly max: number;
  private capacity: number;
  private cursor = 0;
  private alive = 0;
  private tmpColor = new THREE.Color();

  constructor(sprite: THREE.Texture, max = 1400, size = 0.14) {
    this.max = max;
    this.capacity = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.base = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -1000;
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.colAttr = new THREE.BufferAttribute(this.col, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('color', this.colAttr);
    this.material = new THREE.PointsMaterial({
      map: sprite, size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  /** Maximal gleichzeitig lebende Partikel (0 = aus). */
  setCapacity(n: number): void {
    this.capacity = Math.max(0, Math.min(this.max, Math.floor(n)));
    this.points.visible = this.capacity > 0;
  }

  get enabled(): boolean {
    return this.capacity > 0;
  }

  /**
   * Erzeugt `count` Partikel um (x, y, z).
   * @param spread  zufällige Start-Streuung
   * @param speed   Betrag der Zufallsgeschwindigkeit
   * @param up      zusätzliche Aufwärtsgeschwindigkeit
   * @param gravity Abwärtsbeschleunigung (negativ = steigt)
   */
  burst(x: number, y: number, z: number, color: THREE.ColorRepresentation, count: number, spread: number, speed: number, up: number, life: number, gravity: number): void {
    if (this.capacity <= 0) return;
    this.tmpColor.set(color);
    const n = Math.min(count, this.capacity);
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;
      const i3 = i * 3;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this.pos[i3] = x + Math.cos(a) * r * spread;
      this.pos[i3 + 1] = y + (Math.random() - 0.5) * spread * 0.5;
      this.pos[i3 + 2] = z + Math.sin(a) * r * spread;
      const va = Math.random() * Math.PI * 2;
      const vs = speed * (0.4 + Math.random() * 0.6);
      this.vel[i3] = Math.cos(va) * vs;
      this.vel[i3 + 1] = up * (0.6 + Math.random() * 0.8);
      this.vel[i3 + 2] = Math.sin(va) * vs;
      const b = 0.7 + Math.random() * 0.3;
      this.base[i3] = this.tmpColor.r * b;
      this.base[i3 + 1] = this.tmpColor.g * b;
      this.base[i3 + 2] = this.tmpColor.b * b;
      const l = life * (0.7 + Math.random() * 0.6);
      this.life[i] = l;
      this.maxLife[i] = l;
      this.gravity[i] = gravity;
    }
    this.alive = Math.max(this.alive, 1);
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    const n = this.max;
    for (let i = 0; i < n; i++) {
      let l = this.life[i]!;
      if (l <= 0) continue;
      const i3 = i * 3;
      l -= dt;
      if (l <= 0) {
        this.life[i] = 0;
        this.pos[i3 + 1] = -1000;
        this.col[i3] = 0;
        this.col[i3 + 1] = 0;
        this.col[i3 + 2] = 0;
        continue;
      }
      alive++;
      this.life[i] = l;
      this.vel[i3 + 1] = this.vel[i3 + 1]! - this.gravity[i]! * dt;
      this.pos[i3] = this.pos[i3]! + this.vel[i3]! * dt;
      this.pos[i3 + 1] = this.pos[i3 + 1]! + this.vel[i3 + 1]! * dt;
      this.pos[i3 + 2] = this.pos[i3 + 2]! + this.vel[i3 + 2]! * dt;
      const f = l / this.maxLife[i]!;
      const fade = f < 0.5 ? f * 2 : 1;
      this.col[i3] = this.base[i3]! * fade;
      this.col[i3 + 1] = this.base[i3 + 1]! * fade;
      this.col[i3 + 2] = this.base[i3 + 2]! * fade;
    }
    this.alive = alive;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

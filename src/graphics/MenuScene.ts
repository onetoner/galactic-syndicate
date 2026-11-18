import * as THREE from 'three';
import type { Game, Settings } from '../core';
import type { EarthObject } from './Earth';
import type { PointerInfo, SceneContext, SceneController } from './SceneBase';
import { Disposer, makeNebulaTexture, makeStarfield, mulberry } from './util';

interface FlyBy {
  holder: THREE.Group;
  modelId: string;
  scale: number;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  length: number;
  t: number;
  roll: number;
  glow: THREE.Sprite;
}

/** Hintergrund des Startmenüs: Erde im Orbit, Sternenfeld, vorbeifliegende Schmugglerschiffe. Transparent gerendert. */
export class MenuScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 900);

  private d = new Disposer();
  private earth: EarthObject;
  private ships: FlyBy[] = [];
  private assetVersion = -1;
  private rnd = mulberry(4242);
  private engineMat: THREE.SpriteMaterial;
  private engineMat2: THREE.SpriteMaterial;
  private parallaxX = 0;
  private parallaxY = 0;
  private targetPX = 0;
  private targetPY = 0;
  private lookAt = new THREE.Vector3(1.5, 0, 0);

  constructor(private ctx: SceneContext) {
    this.scene.background = null;
    this.earth = ctx.earth.create(7);
    this.earth.root.position.set(7.5, -3.2, -8);
    this.earth.root.rotation.z = 0.35;
    this.scene.add(this.earth.root);
    this.scene.add(makeStarfield(this.d, 1500, 260, 99, ctx.glowTexture));

    const sun = new THREE.DirectionalLight(0xfff0d8, 3.4);
    sun.position.set(-10, 5, 3);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x5870a8, 0.5));
    const rim = new THREE.DirectionalLight(0x35e0ff, 0.8);
    rim.position.set(6, -2, 8);
    this.scene.add(rim);

    // farbige Nebel
    const nebA = this.d.track(makeNebulaTexture(11));
    const nebB = this.d.track(makeNebulaTexture(23));
    const neb = (tex: THREE.Texture, color: number, x: number, y: number, z: number, size: number, opacity: number): void => {
      const mat = this.d.track(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      const s = new THREE.Sprite(mat);
      s.position.set(x, y, z);
      s.scale.set(size, size, 1);
      s.renderOrder = -5;
      this.scene.add(s);
    };
    neb(nebA, 0xff3d9a, -30, 12, -90, 120, 0.5);
    neb(nebB, 0x35e0ff, 35, -18, -110, 140, 0.4);
    neb(nebA, 0x7a5cff, 5, 30, -130, 150, 0.35);

    this.engineMat = this.d.track(new THREE.SpriteMaterial({ map: ctx.glowTexture, color: 0x35e0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.engineMat2 = this.d.track(new THREE.SpriteMaterial({ map: ctx.glowTexture, color: 0xff3d9a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));

    const specs: [string, number][] = [
      ['spaceship_smuggler', 0.34], ['spaceship_freighter', 0.26], ['spaceship_smuggler', 0.26], ['spaceship_warship', 0.2], ['spaceship_smuggler', 0.2],
    ];
    specs.forEach(([modelId, scale], i) => {
      const holder = new THREE.Group();
      const glow = new THREE.Sprite(i % 2 === 0 ? this.engineMat : this.engineMat2);
      this.scene.add(holder);
      const f: FlyBy = { holder, modelId, scale, start: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 1, length: 1, t: 0, roll: 0, glow };
      this.respawn(f, true);
      f.t = this.rnd() * f.length * 0.8 + i * 1.5;
      this.ships.push(f);
    });

    this.camera.position.set(0, 0.6, 14);
    this.camera.lookAt(this.lookAt);
  }

  private respawn(f: FlyBy, first: boolean): void {
    const r = this.rnd;
    const fromLeft = r() < 0.6;
    const depth = -1 - r() * 9;
    const y0 = -4 + r() * 7;
    const span = 20 + -depth * 1.4;
    f.start.set(fromLeft ? -span : span, y0, depth);
    f.dir.set(fromLeft ? 1 : -1, (r() - 0.5) * 0.25, (r() - 0.5) * 0.35).normalize();
    f.speed = 1.3 + r() * 2.2;
    f.length = span * 2.1;
    f.t = first ? 0 : -r() * 6;
    f.roll = (r() - 0.5) * 0.5;
  }

  private buildShips(): void {
    this.assetVersion = this.ctx.assets.version;
    for (const f of this.ships) {
      f.holder.clear();
      const model = this.ctx.assets.instantiate(f.modelId);
      model.scale.setScalar(f.scale);
      f.holder.add(model);
      // Triebwerks-Glühen am Heck (Bug zeigt nach +Z)
      const len = f.modelId === 'spaceship_smuggler' ? 4 : f.modelId === 'spaceship_freighter' ? 8 : 10;
      f.glow.position.set(0, 0.18 * f.scale * 3, -len * 0.5 * f.scale - 0.05);
      f.glow.scale.setScalar(f.scale * 3.4);
      f.holder.add(f.glow);
    }
  }

  setGame(_game: Game | null): void {
    /* das Menü zeigt keinen Spielzustand */
  }

  applySettings(_settings: Settings): void {
    /* nichts einstellbar */
  }

  onEnter(): void {
    /* – */
  }

  onPointerDown(_p: PointerInfo): void { /* – */ }

  onPointerMove(p: PointerInfo): void {
    this.targetPX = p.nx;
    this.targetPY = p.ny;
  }

  onPointerUp(_p: PointerInfo): void { /* – */ }

  onPointerLeave(): void {
    this.targetPX = 0;
    this.targetPY = 0;
  }

  onWheel(_delta: number): void { /* – */ }

  onKeyDown(_code: string): boolean {
    return false;
  }

  update(dt: number, time: number): void {
    if (this.assetVersion !== this.ctx.assets.version) this.buildShips();
    this.earth.spin.rotation.y += dt * 0.035;
    this.earth.clouds.rotation.y += dt * 0.012;

    const tmp = this.lookAt;
    for (const f of this.ships) {
      f.t += dt * f.speed;
      if (f.t > f.length) this.respawn(f, false);
      const t = Math.max(0, f.t);
      f.holder.visible = f.t >= 0;
      f.holder.position.copy(f.start).addScaledVector(f.dir, t);
      f.holder.position.y += Math.sin(time * 0.7 + f.roll * 10) * 0.08;
      tmp.copy(f.holder.position).add(f.dir);
      f.holder.lookAt(tmp);
      f.holder.rotateZ(f.roll + Math.sin(time * 0.5 + f.speed) * 0.06);
      const flick = 1 + Math.sin(time * 30 + f.speed * 7) * 0.12;
      f.glow.scale.setScalar(f.scale * 3.4 * flick);
    }

    // langsame Kamerafahrt + leichte Maus-Parallaxe
    this.parallaxX += (this.targetPX - this.parallaxX) * Math.min(1, dt * 2);
    this.parallaxY += (this.targetPY - this.parallaxY) * Math.min(1, dt * 2);
    this.camera.position.set(Math.sin(time * 0.05) * 1.2 + this.parallaxX * 0.5, 0.6 + Math.sin(time * 0.07) * 0.4 + this.parallaxY * 0.3, 14);
    this.lookAt.set(1.5, 0, 0);
    this.camera.lookAt(this.lookAt);
  }

  dispose(): void {
    this.ships.forEach((f) => f.holder.clear());
    this.d.dispose();
  }
}

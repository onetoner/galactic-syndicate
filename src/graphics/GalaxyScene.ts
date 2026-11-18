import * as THREE from 'three';
import { PLAYER_COLOR, SCAN_RANGE, SOL_ID } from '../core';
import type { GalaxyNode, Game, Settings, Ship } from '../core';
import { OrbitRig } from './CameraRig';
import { ParticleSystem } from './Particles';
import type { PointerInfo, SceneContext, SceneController } from './SceneBase';
import { Disposer, makeLabelSprite, makeNebulaTexture, makeStarfield } from './util';
import type { LabelSprite } from './util';

interface StarVisual {
  node: GalaxyNode;
  pos: THREE.Vector3;
  star: THREE.Sprite;
  ring: THREE.Sprite;
  baseRing: number;
}

interface ShipVisual {
  holder: THREE.Group;
  glow: THREE.Sprite;
  key: string;
  trailTimer: number;
}

interface RouteVisual {
  line: THREE.Line;
  dots: THREE.Sprite[];
  a: THREE.Vector3;
  b: THREE.Vector3;
  geo: THREE.BufferGeometry;
}

const MAX_LABELS = 16;

/** 3D-Sternenkarte mit Systemen, Schiffen im Transit und animierten Handelsrouten. */
export class GalaxyScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 2000);

  private rig = new OrbitRig(this.camera);
  private game: Game | null = null;
  private offs: (() => void)[] = [];
  private d = new Disposer();

  private starGroup = new THREE.Group();
  private labelGroup = new THREE.Group();
  private shipGroup = new THREE.Group();
  private routeGroup = new THREE.Group();
  private stars = new Map<string, StarVisual>();
  private starMats = new Map<string, THREE.SpriteMaterial>();
  private ringMats = new Map<string, THREE.SpriteMaterial>();
  private labels = new Map<string, LabelSprite>();
  private ships = new Map<number, ShipVisual>();
  private routes = new Map<number, RouteVisual>();
  private routeKey = '';
  private nodesKey = '';
  private nodesDirty = true;
  private nodeTimer = 0;
  private labelTimer = 0;
  private assetVersion = -1;

  private selected: string | null = null;
  private hovered: string | null = null;
  private selectMarker: THREE.Sprite;
  private hoverMarker: THREE.Sprite;
  private engineMat: THREE.SpriteMaterial;
  private dotMat: THREE.SpriteMaterial;
  private routeMat: THREE.LineBasicMaterial;
  private flightMat: THREE.LineBasicMaterial;
  private flightLines = new Map<number, { line: THREE.Line; geo: THREE.BufferGeometry }>();
  private particles: ParticleSystem;
  private posCache = new Map<string, THREE.Vector3>();

  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();

  constructor(private ctx: SceneContext) {
    this.scene.background = new THREE.Color(0x04060e);
    this.scene.add(makeStarfield(this.d, 2600, 900, 5, ctx.glowTexture));
    this.scene.add(new THREE.AmbientLight(0x8aa4d8, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(4, 10, 6);
    this.scene.add(key);

    // Nebel-Wolken weit im Hintergrund
    const nebA = this.d.track(makeNebulaTexture(31));
    const nebB = this.d.track(makeNebulaTexture(47));
    const neb = (tex: THREE.Texture, color: number, x: number, y: number, z: number, size: number, opacity: number): void => {
      const mat = this.d.track(new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      const s = new THREE.Sprite(mat);
      s.position.set(x, y, z);
      s.scale.set(size, size, 1);
      s.renderOrder = -5;
      this.scene.add(s);
    };
    neb(nebA, 0xff3d9a, -260, -120, -420, 620, 0.42);
    neb(nebB, 0x35e0ff, 320, -160, -300, 560, 0.34);
    neb(nebA, 0x6a4cff, 60, -220, 380, 700, 0.3);
    neb(nebB, 0xffc24a, -380, -140, 260, 480, 0.16);

    // Orientierungsringe um Sol
    const ringLine = (radius: number, color: number, opacity: number): void => {
      const pts: number[] = [];
      for (let i = 0; i < 96; i++) {
        const a = (i / 96) * Math.PI * 2;
        pts.push(Math.cos(a) * radius, 0, Math.sin(a) * radius);
      }
      const geo = this.d.track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = this.d.track(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
      this.scene.add(new THREE.LineLoop(geo, mat));
    };
    ringLine(SCAN_RANGE, 0x35e0ff, 0.28);
    ringLine(SCAN_RANGE * 0.5, 0x35e0ff, 0.12);
    ringLine(SCAN_RANGE * 2, 0x35e0ff, 0.1);
    ringLine(SCAN_RANGE * 4, 0x35e0ff, 0.06);

    this.scene.add(this.routeGroup, this.starGroup, this.shipGroup, this.labelGroup);

    const mk = (color: number, opacity: number): THREE.SpriteMaterial =>
      this.d.track(new THREE.SpriteMaterial({ map: ctx.ringTexture, color, transparent: true, opacity, depthWrite: false, depthTest: false, fog: false }));
    this.selectMarker = new THREE.Sprite(mk(0xffffff, 0.95));
    this.selectMarker.visible = false;
    this.selectMarker.renderOrder = 12;
    this.hoverMarker = new THREE.Sprite(mk(0xffffff, 0.45));
    this.hoverMarker.visible = false;
    this.hoverMarker.renderOrder = 11;
    this.scene.add(this.selectMarker, this.hoverMarker);

    this.engineMat = this.d.track(new THREE.SpriteMaterial({ map: ctx.glowTexture, color: 0x7ae8ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.dotMat = this.d.track(new THREE.SpriteMaterial({ map: ctx.glowTexture, color: 0xffc24a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.routeMat = this.d.track(new THREE.LineBasicMaterial({ color: 0xffc24a, transparent: true, opacity: 0.55, depthWrite: false }));
    this.flightMat = this.d.track(new THREE.LineBasicMaterial({ color: 0x7ae8ff, transparent: true, opacity: 0.35, depthWrite: false }));

    this.particles = new ParticleSystem(ctx.glowTexture, 600, 0.5);
    this.scene.add(this.particles.points);

    this.rig.minDistance = 5;
    this.rig.maxDistance = 320;
    this.rig.minPitch = 0.12;
    this.rig.maxPitch = 1.52;
    this.rig.distance = 52;
    this.rig.pitch = 0.95;
    this.rig.yaw = 0.3;
    this.rig.snap();
  }

  // ------------------------------------------------------------------ Anbindung

  setGame(game: Game | null): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    this.game = game;
    this.clearStars();
    this.clearShips();
    this.clearRoutes();
    this.posCache.clear();
    this.nodesKey = '';
    this.routeKey = '';
    this.nodesDirty = true;
    this.selected = null;
    this.hovered = null;
    this.selectMarker.visible = false;
    this.hoverMarker.visible = false;
    if (!game) return;
    const dirty = (): void => {
      this.nodesDirty = true;
    };
    this.offs.push(
      game.events.on('discovery', dirty),
      game.events.on('takeover', dirty),
      game.events.on('systemLost', dirty),
      game.events.on('sabotage', dirty),
      game.events.on('ship', dirty),
    );
    this.rig.target.set(0, 0, 0);
    this.rig.distance = 52;
    this.rig.snap();
  }

  applySettings(settings: Settings): void {
    this.rig.options = { ...settings.controls };
    const p = settings.graphics.particles;
    this.particles.setCapacity(p === 'high' ? 600 : p === 'low' ? 200 : 0);
    this.camera.far = Math.max(1200, settings.graphics.viewDistance * 8);
    this.camera.updateProjectionMatrix();
    this.rig.maxDistance = Math.max(120, settings.graphics.viewDistance * 1.2);
  }

  onEnter(): void {
    this.nodesDirty = true;
    this.labelTimer = 0;
  }

  focusSystem(systemId: string): void {
    const p = this.systemPos(systemId);
    if (!p) return;
    this.rig.focus(p, Math.min(this.rig.distance, 30));
  }

  setSelectedSystem(systemId: string | null): void {
    this.selected = systemId;
    this.labelTimer = 0;
  }

  private systemPos(id: string): THREE.Vector3 | null {
    let p = this.posCache.get(id);
    if (p) return p;
    const sys = this.game ? this.game.getSystem(id) : null;
    if (!sys) return null;
    p = new THREE.Vector3(sys.pos.x, sys.pos.y, sys.pos.z);
    this.posCache.set(id, p);
    return p;
  }

  // ------------------------------------------------------------------ Sterne

  private clearStars(): void {
    this.starGroup.clear();
    this.stars.clear();
    this.labels.forEach((l) => l.dispose());
    this.labels.clear();
    this.labelGroup.clear();
  }

  private starMat(color: string, dim: boolean): THREE.SpriteMaterial {
    const key = `${color}|${dim ? 1 : 0}`;
    let m = this.starMats.get(key);
    if (!m) {
      m = this.d.track(
        new THREE.SpriteMaterial({ map: this.ctx.glowTexture, color, transparent: true, opacity: dim ? 0.7 : 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      this.starMats.set(key, m);
    }
    return m;
  }

  private ringMat(color: string, own: boolean): THREE.SpriteMaterial {
    const key = `${color}|${own ? 1 : 0}`;
    let m = this.ringMats.get(key);
    if (!m) {
      m = this.d.track(new THREE.SpriteMaterial({ map: this.ctx.ringTexture, color, transparent: true, opacity: own ? 1 : 0.6, depthWrite: false, fog: false }));
      this.ringMats.set(key, m);
    }
    return m;
  }

  private refreshNodes(): void {
    const g = this.game;
    if (!g) return;
    this.nodesDirty = false;
    const nodes = g.getGalaxyView();
    let key = '';
    for (const n of nodes) key += `${n.id}:${n.controller}:${n.visited ? 1 : 0};`;
    if (key === this.nodesKey) {
      // nur Daten auffrischen (Marktanteil usw.)
      for (const n of nodes) {
        const v = this.stars.get(n.id);
        if (v) v.node = n;
      }
      return;
    }
    this.nodesKey = key;
    this.starGroup.clear();
    this.stars.clear();
    for (const n of nodes) {
      const pos = new THREE.Vector3(n.pos.x, n.pos.y, n.pos.z);
      this.posCache.set(n.id, pos);
      const star = new THREE.Sprite(this.starMat(n.starColor, !n.visited && !n.isSol));
      const size = n.isSol ? 3.4 : 2.3;
      star.scale.set(size, size, 1);
      star.position.copy(pos);
      const own = n.isPlayerOwned;
      const ring = new THREE.Sprite(this.ringMat(n.isSol ? PLAYER_COLOR : n.controllerColor, own || n.isSol));
      const baseRing = n.isSol ? 2.6 : own ? 2.4 : 1.5;
      ring.scale.set(baseRing, baseRing, 1);
      ring.position.copy(pos);
      this.starGroup.add(ring, star);
      this.stars.set(n.id, { node: n, pos, star, ring, baseRing });
    }
    this.labelTimer = 0;
  }

  private refreshLabels(): void {
    const want = new Set<string>();
    const cands: { id: string; d: number }[] = [];
    this.stars.forEach((v, id) => {
      if (v.node.isSol || v.node.isPlayerOwned || id === this.selected || id === this.hovered) want.add(id);
      else cands.push({ id, d: v.pos.distanceToSquared(this.rig.target) });
    });
    cands.sort((a, b) => a.d - b.d);
    const limit = this.rig.distance * 1.1;
    for (const c of cands) {
      if (want.size >= MAX_LABELS) break;
      if (c.d > limit * limit) break;
      want.add(c.id);
    }
    // entfernen
    this.labels.forEach((l, id) => {
      if (!want.has(id)) {
        this.labelGroup.remove(l.sprite);
        l.dispose();
        this.labels.delete(id);
      }
    });
    // anlegen
    want.forEach((id) => {
      if (this.labels.has(id)) return;
      const v = this.stars.get(id);
      if (!v) return;
      const color = v.node.isSol ? '#ffe9a8' : v.node.isPlayerOwned ? PLAYER_COLOR : '#d6e2f5';
      const l = makeLabelSprite(v.node.name, color, 1);
      l.sprite.userData.systemId = id;
      l.sprite.center.set(0.5, -0.9);
      this.labelGroup.add(l.sprite);
      this.labels.set(id, l);
    });
  }

  // ------------------------------------------------------------------ Schiffe

  private clearShips(): void {
    this.shipGroup.clear();
    this.ships.clear();
    this.flightLines.forEach((f) => {
      this.routeGroup.remove(f.line);
      f.geo.dispose();
    });
    this.flightLines.clear();
  }

  private shipPosition(ship: Ship, index: number, time: number, out: THREE.Vector3, ahead: THREE.Vector3): boolean {
    const g = this.game;
    if (!g) return false;
    if (ship.status === 'transit') {
      const a = this.systemPos(ship.from);
      const b = this.systemPos(ship.to);
      if (!a || !b) return false;
      const step = ship.travelTicks > 0 ? 1 / ship.travelTicks : 0;
      const t = Math.min(1, Math.max(0, ship.progress + (ship.halted || g.state.speed === 0 ? 0 : g.tickAlpha * step)));
      out.copy(a).lerp(b, t);
      // leichter Bogen über der Ebene
      out.y += Math.sin(t * Math.PI) * Math.min(3, a.distanceTo(b) * 0.06);
      ahead.copy(b);
      return true;
    }
    if (ship.status === 'docked' || ship.status === 'stationed') {
      const c = this.systemPos(ship.location);
      if (!c) return false;
      const r = ship.status === 'stationed' ? 1.5 : 1.15;
      const ang = time * (ship.status === 'stationed' ? 0.5 : 0.3) + index * 2.1;
      out.set(c.x + Math.cos(ang) * r, c.y + 0.25 + (index % 3) * 0.12, c.z + Math.sin(ang) * r);
      ahead.set(c.x + Math.cos(ang + 0.3) * r, out.y, c.z + Math.sin(ang + 0.3) * r);
      return true;
    }
    return false;
  }

  private updateShips(dt: number, time: number): void {
    const g = this.game;
    if (!g) return;
    if (this.assetVersion !== this.ctx.assets.version) {
      this.assetVersion = this.ctx.assets.version;
      this.clearShips();
    }
    const seen = new Set<number>();
    let index = 0;
    for (const ship of g.state.ships) {
      index++;
      if (!this.shipPosition(ship, index, time, this.tmp, this.tmp2)) continue;
      seen.add(ship.id);
      let v = this.ships.get(ship.id);
      const key = ship.design.hull;
      if (!v || v.key !== key) {
        if (v) this.shipGroup.remove(v.holder);
        const modelId = key === 'hull_freighter' ? 'spaceship_freighter' : key === 'hull_warship' ? 'spaceship_warship' : 'spaceship_smuggler';
        const len = modelId === 'spaceship_smuggler' ? 4 : modelId === 'spaceship_freighter' ? 8 : 10;
        const scale = 1.5 / len;
        const holder = new THREE.Group();
        const model = this.ctx.assets.instantiate(modelId);
        model.scale.setScalar(scale);
        holder.add(model);
        const glow = new THREE.Sprite(this.engineMat);
        glow.position.set(0, 0.06, -0.85);
        glow.scale.setScalar(0.9);
        holder.add(glow);
        this.shipGroup.add(holder);
        v = { holder, glow, key, trailTimer: 0 };
        this.ships.set(ship.id, v);
      }
      v.holder.position.copy(this.tmp);
      v.holder.lookAt(this.tmp2);
      const flying = ship.status === 'transit' && !ship.halted;
      v.glow.visible = flying;
      if (flying) {
        v.glow.scale.setScalar(0.9 * (1 + Math.sin(time * 26 + ship.id) * 0.15));
        v.trailTimer -= dt;
        if (v.trailTimer <= 0 && this.particles.enabled) {
          v.trailTimer = 0.09;
          this.particles.burst(this.tmp.x, this.tmp.y, this.tmp.z, 0x4fc8ff, 1, 0.08, 0.05, 0, 1.6, 0);
        }
      }
      // Fluglinie
      let fl = this.flightLines.get(ship.id);
      if (ship.status === 'transit') {
        const a = this.systemPos(ship.from);
        const b = this.systemPos(ship.to);
        if (a && b) {
          if (!fl) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
            const line = new THREE.Line(geo, this.flightMat);
            line.frustumCulled = false;
            this.routeGroup.add(line);
            fl = { line, geo };
            this.flightLines.set(ship.id, fl);
          }
          const attr = fl.geo.getAttribute('position') as THREE.BufferAttribute;
          attr.setXYZ(0, this.tmp.x, this.tmp.y, this.tmp.z);
          attr.setXYZ(1, b.x, b.y, b.z);
          attr.needsUpdate = true;
        }
      } else if (fl) {
        this.routeGroup.remove(fl.line);
        fl.geo.dispose();
        this.flightLines.delete(ship.id);
      }
    }
    // verschwundene Schiffe entfernen
    this.ships.forEach((v, id) => {
      if (!seen.has(id)) {
        this.shipGroup.remove(v.holder);
        this.ships.delete(id);
        const fl = this.flightLines.get(id);
        if (fl) {
          this.routeGroup.remove(fl.line);
          fl.geo.dispose();
          this.flightLines.delete(id);
        }
      }
    });
  }

  // ------------------------------------------------------------------ Routen

  private clearRoutes(): void {
    this.routes.forEach((r) => {
      this.routeGroup.remove(r.line);
      r.dots.forEach((dot) => this.routeGroup.remove(dot));
      r.geo.dispose();
    });
    this.routes.clear();
  }

  private updateRoutes(time: number): void {
    const g = this.game;
    if (!g) return;
    let key = '';
    for (const r of g.state.routes) key += `${r.id}:${r.systemId}:${r.enabled ? 1 : 0};`;
    if (key !== this.routeKey) {
      this.routeKey = key;
      this.clearRoutes();
      const sol = this.systemPos(SOL_ID);
      for (const r of g.state.routes) {
        if (!r.enabled) continue;
        const b = this.systemPos(r.systemId);
        if (!sol || !b) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([sol.x, sol.y, sol.z, b.x, b.y, b.z]), 3));
        const line = new THREE.Line(geo, this.routeMat);
        this.routeGroup.add(line);
        const dots: THREE.Sprite[] = [];
        for (let i = 0; i < 4; i++) {
          const dot = new THREE.Sprite(this.dotMat);
          dot.scale.setScalar(0.9);
          this.routeGroup.add(dot);
          dots.push(dot);
        }
        this.routes.set(r.id, { line, dots, a: sol, b, geo });
      }
    }
    this.routes.forEach((r) => {
      const len = Math.max(1, r.a.distanceTo(r.b));
      const speed = 4 / len;
      for (let i = 0; i < r.dots.length; i++) {
        const dot = r.dots[i]!;
        let t = (time * speed + i / r.dots.length) % 1;
        if (i % 2 === 1) t = 1 - t;
        dot.position.copy(r.a).lerp(r.b, t);
      }
    });
  }

  // ------------------------------------------------------------------ Zeiger

  private pickSystem(p: PointerInfo): string | null {
    let best: string | null = null;
    let bestD = 22;
    const w = this.ctx.input.width;
    const h = this.ctx.input.height;
    this.stars.forEach((v, id) => {
      this.tmp.copy(v.pos).project(this.camera);
      if (this.tmp.z > 1 || this.tmp.z < -1) return;
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      const dist = Math.hypot(sx - p.px, sy - p.py);
      if (dist < bestD) {
        bestD = dist;
        best = id;
      }
    });
    return best;
  }

  onPointerDown(_p: PointerInfo): void { /* – */ }

  onPointerMove(p: PointerInfo): void {
    if (p.buttons & 6) {
      this.rig.rotate(p.dx, p.dy);
      return;
    }
    if (p.buttons & 1) {
      this.rig.dragPan(p.dx, p.dy);
      return;
    }
    const h = this.pickSystem(p);
    if (h !== this.hovered) {
      this.hovered = h;
      this.labelTimer = 0;
      this.ctx.setCursor(h ? 'pointer' : 'default');
    }
  }

  onPointerUp(p: PointerInfo): void {
    if (!p.isClick || p.button !== 0) return;
    const id = this.pickSystem(p);
    this.selected = id;
    this.labelTimer = 0;
    this.ctx.emit('systemSelect', { systemId: id });
  }

  onPointerLeave(): void {
    this.hovered = null;
  }

  onWheel(delta: number): void {
    this.rig.zoom(delta);
  }

  onKeyDown(_code: string): boolean {
    return false;
  }

  // ------------------------------------------------------------------ Frame

  update(dt: number, time: number): void {
    this.rig.update(dt, this.ctx.input);
    if (!this.game) return;
    this.nodeTimer -= dt;
    if (this.nodesDirty || this.nodeTimer <= 0) {
      this.nodeTimer = 1;
      this.refreshNodes();
    }
    this.labelTimer -= dt;
    if (this.labelTimer <= 0) {
      this.labelTimer = 0.4;
      this.refreshLabels();
    }

    // eigene Systeme pulsieren
    const pulse = 1 + Math.sin(time * 3) * 0.12;
    this.stars.forEach((v) => {
      if (v.node.isPlayerOwned) v.ring.scale.setScalar(v.baseRing * pulse);
    });

    // Labels in konstanter Bildschirmgröße
    this.labels.forEach((l, id) => {
      const v = this.stars.get(id);
      if (!v) return;
      l.sprite.position.copy(v.pos);
      const dist = this.camera.position.distanceTo(v.pos);
      const hgt = dist * 0.028;
      const aspect = l.sprite.scale.x / Math.max(1e-6, l.sprite.scale.y);
      l.sprite.scale.set(hgt * aspect, hgt, 1);
    });

    const mark = (sprite: THREE.Sprite, id: string | null, size: number): void => {
      const v = id ? this.stars.get(id) : undefined;
      sprite.visible = !!v;
      if (v) {
        sprite.position.copy(v.pos);
        const dist = this.camera.position.distanceTo(v.pos);
        sprite.scale.setScalar(Math.max(3, dist * size));
      }
    };
    mark(this.selectMarker, this.selected, 0.075 * (1 + Math.sin(time * 5) * 0.08));
    mark(this.hoverMarker, this.hovered !== this.selected ? this.hovered : null, 0.06);

    this.updateShips(dt, time);
    this.updateRoutes(time);
    this.particles.update(dt);
  }

  dispose(): void {
    this.offs.forEach((off) => off());
    this.offs = [];
    this.clearStars();
    this.clearShips();
    this.clearRoutes();
    this.particles.dispose();
    this.d.dispose();
  }
}

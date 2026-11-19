import * as THREE from 'three';
import type { Game, SectorType, Settings } from '../core';
import { OrbitRig } from './CameraRig';
import { latLonToVector, snapToLand } from './Earth';
import type { EarthObject } from './Earth';
import type { GestureInfo, PointerInfo, SceneContext, SceneController } from './SceneBase';
import { Disposer, makeLabelSprite, makeStarfield } from './util';
import type { LabelSprite } from './util';

const TYPE_COLORS: Record<SectorType, number> = {
  slum: 0xffc24a,
  warehouse: 0x35e0ff,
  bunker: 0xb8c4d0,
  industrial: 0xff8a3d,
  spaceport: 0xff3d9a,
};

interface Marker {
  sectorId: number;
  group: THREE.Group;
  label: LabelSprite;
  ring: THREE.Sprite | null;
  /** Normale in lokalen (spin-)Koordinaten */
  normal: THREE.Vector3;
}

const EARTH_RADIUS = 5;

/** Planeten-Übersicht: Erde mit Markern für alle eigenen Sektoren. */
export class PlanetScene implements SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 800);

  private rig = new OrbitRig(this.camera);
  private game: Game | null = null;
  private earth: EarthObject;
  private d = new Disposer();
  private markers: Marker[] = [];
  private markerKey = '';
  private checkTimer = 0;
  private hovered: number | null = null;
  private dragging = false;
  private pinGeo: THREE.ConeGeometry;
  private mats = new Map<number, { pin: THREE.MeshBasicMaterial; glow: THREE.SpriteMaterial }>();
  private ringMat: THREE.SpriteMaterial;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private camDir = new THREE.Vector3();

  constructor(private ctx: SceneContext) {
    this.scene.background = new THREE.Color(0x03050c);
    this.earth = ctx.earth.create(EARTH_RADIUS);
    this.scene.add(this.earth.root);
    this.scene.add(makeStarfield(this.d, 1800, 300, 77, ctx.glowTexture));
    const sun = new THREE.DirectionalLight(0xfff2dd, 3.2);
    sun.position.set(12, 6, 10);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0x6f86b8, 0.55));

    this.pinGeo = this.d.track(new THREE.ConeGeometry(0.02, 0.1, 6));
    this.pinGeo.rotateX(Math.PI);
    this.pinGeo.translate(0, 0.05, 0);
    this.ringMat = this.d.track(new THREE.SpriteMaterial({ map: ctx.ringTexture, color: 0xffffff, transparent: true, depthWrite: false, fog: false }));

    this.rig.panEnabled = false;
    this.rig.minDistance = 7.5;
    this.rig.maxDistance = 34;
    this.rig.minPitch = -1.25;
    this.rig.maxPitch = 1.25;
    this.rig.distance = 16;
    this.rig.pitch = 0.35;
    this.rig.yaw = 0.4;
    this.rig.snap();
  }

  setGame(game: Game | null): void {
    this.game = game;
    this.clearMarkers();
    this.markerKey = '';
    this.checkTimer = 0;
  }

  applySettings(settings: Settings): void {
    this.rig.options = { ...settings.controls };
  }

  onEnter(): void {
    this.checkTimer = 0;
    this.refreshMarkers();
    // Kamera auf den aktiven Sektor drehen
    const g = this.game;
    if (!g) return;
    const m = this.markers.find((x) => x.sectorId === g.state.activeSectorId);
    if (m) {
      this.earth.spin.updateMatrixWorld(true);
      this.tmp.copy(m.normal).transformDirection(this.earth.spin.matrixWorld);
      this.rig.yaw = Math.atan2(this.tmp.x, this.tmp.z);
      this.rig.pitch = Math.min(this.rig.maxPitch, Math.max(this.rig.minPitch, Math.asin(Math.min(1, Math.max(-1, this.tmp.y))) * 0.8 + 0.1));
    }
  }

  private matsFor(color: number): { pin: THREE.MeshBasicMaterial; glow: THREE.SpriteMaterial } {
    let m = this.mats.get(color);
    if (!m) {
      m = {
        pin: this.d.track(new THREE.MeshBasicMaterial({ color })),
        glow: this.d.track(new THREE.SpriteMaterial({ map: this.ctx.glowTexture, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })),
      };
      this.mats.set(color, m);
    }
    return m;
  }

  private clearMarkers(): void {
    for (const m of this.markers) {
      this.earth.spin.remove(m.group);
      m.label.dispose();
    }
    this.markers = [];
  }

  private refreshMarkers(): void {
    const g = this.game;
    if (!g) return;
    let key = `${g.state.activeSectorId}`;
    for (const s of g.state.sectors) key += `|${s.id}:${s.name}:${s.type}`;
    if (key === this.markerKey) return;
    this.markerKey = key;
    this.clearMarkers();
    for (const s of g.state.sectors) {
      const color = TYPE_COLORS[s.type];
      const mats = this.matsFor(color);
      const group = new THREE.Group();
      const spot = snapToLand(s.lat, s.lon);
      const normal = latLonToVector(spot.lat, spot.lon, 1, new THREE.Vector3()).normalize();
      group.position.copy(normal).multiplyScalar(1.004);
      // lokale +Y-Achse entlang der Oberflächennormalen ausrichten
      group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
      const pin = new THREE.Mesh(this.pinGeo, mats.pin);
      group.add(pin);
      const glow = new THREE.Sprite(mats.glow);
      glow.scale.set(0.2, 0.2, 1);
      glow.position.y = 0.11;
      group.add(glow);
      const active = s.id === g.state.activeSectorId;
      let ring: THREE.Sprite | null = null;
      if (active) {
        ring = new THREE.Sprite(this.ringMat);
        ring.scale.set(0.16, 0.16, 1);
        ring.position.y = 0.11;
        group.add(ring);
      }
      const label = makeLabelSprite(s.name, active ? '#ffffff' : `#${new THREE.Color(color).getHexString()}`, 0.05);
      label.sprite.position.y = 0.3;
      group.add(label.sprite);
      this.earth.spin.add(group);
      this.markers.push({ sectorId: s.id, group, label, ring, normal });
    }
  }

  private pickMarker(p: PointerInfo): number | null {
    let best: number | null = null;
    // Finger brauchen eine größere Trefferfläche als der Mauszeiger
    let bestD = p.touch ? 44 : 26;
    for (const m of this.markers) {
      if (!m.group.visible) continue;
      this.tmp.set(0, 0.11, 0);
      m.group.localToWorld(this.tmp);
      this.tmp.project(this.camera);
      const sx = (this.tmp.x * 0.5 + 0.5) * this.ctx.input.width;
      const sy = (-this.tmp.y * 0.5 + 0.5) * this.ctx.input.height;
      const dist = Math.hypot(sx - p.px, sy - p.py);
      if (dist < bestD) {
        bestD = dist;
        best = m.sectorId;
      }
    }
    return best;
  }

  onPointerDown(_p: PointerInfo): void {
    this.dragging = true;
  }

  onPointerMove(p: PointerInfo): void {
    if (p.touch) {
      // ein Finger zieht: Globus drehen – nah herangezoomt langsamer, damit die Oberfläche dem Finger folgt
      const k = Math.min(1.4, Math.max(0.35, this.rig.distance / 16));
      this.rig.touchRotate(-p.dx * 0.0055 * k, p.dy * 0.0045 * k);
      return;
    }
    if (p.buttons !== 0) {
      this.rig.rotate(p.dx, p.dy);
      return;
    }
    const h = this.pickMarker(p);
    if (h !== this.hovered) {
      this.hovered = h;
      this.ctx.setCursor(h !== null ? 'pointer' : 'grab');
    }
  }

  onPointerUp(p: PointerInfo): void {
    this.dragging = false;
    if (!p.isClick || p.button !== 0) return;
    const id = this.pickMarker(p);
    if (id !== null) this.ctx.emit('sectorSelect', { sectorId: String(id) });
    if (p.touch) this.hovered = null;
  }

  /** zwei Finger: Pinch = Zoom */
  onGesture(g: GestureInfo): void {
    this.rig.touchZoom(g.scale);
  }

  onPointerLeave(): void {
    this.dragging = false;
    this.hovered = null;
  }

  onWheel(delta: number): void {
    this.rig.zoom(delta);
  }

  onKeyDown(_code: string): boolean {
    return false;
  }

  update(dt: number, time: number): void {
    this.rig.update(dt, null);
    if (!this.dragging) this.earth.spin.rotation.y += dt * 0.02;
    this.earth.clouds.rotation.y += dt * 0.008;
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.5;
      this.refreshMarkers();
    }
    // Marker auf der Rückseite ausblenden, Labels in konstanter Bildschirmgröße
    this.earth.spin.updateMatrixWorld(true);
    this.camDir.copy(this.camera.position).normalize();
    const scale = this.rig.distance / 16;
    for (const m of this.markers) {
      this.tmp2.copy(m.normal).transformDirection(this.earth.spin.matrixWorld);
      m.group.visible = this.tmp2.dot(this.camDir) > 0.3;
      m.group.scale.setScalar(Math.max(0.6, scale));
      if (m.ring) m.ring.scale.setScalar(0.16 * (1 + Math.sin(time * 4) * 0.12));
    }
  }

  dispose(): void {
    this.clearMarkers();
    this.d.dispose();
  }
}

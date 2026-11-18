import { BUILDINGS, ITEMS, SEED_IDS, STRAINS, TRADE_GOOD_IDS, strainOfSeed } from '../core';
import type {
  BuildingType, ContrabandId, EncounterChoice, GraphicsPreset, ItemId, Quality, RecipeId, SectorType, SeedId, ShipDesign, SimSpeed,
} from '../core';
import type { GameView, LeftPanel, Ui } from './Ui';
import { cr } from './dom';

export type ActionFn = (d: Record<string, string>, el: HTMLElement) => void;
export type ActionMap = Record<string, ActionFn>;

const int = (v: string | undefined, fallback = 0): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Slot-Name aus einem frei eingegebenen Namen ableiten ([A-Za-z0-9_-]{1,40}). */
export function slotFromLabel(label: string): string {
  const s = label
    .trim()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return s && s !== 'autosave' ? s : 'spielstand';
}

/** Nach erfolgreichem Absenden: fokussiertes Textfeld leeren und loslassen (sonst stellt der Neuaufbau den alten Text wieder her). */
function clearActiveInput(): void {
  const a = document.activeElement;
  if (a instanceof HTMLInputElement && a.type !== 'range') {
    a.value = '';
    a.blur();
  }
}

export function createActions(ui: Ui): ActionMap {
  const g = ui.game;
  const s = ui.s;
  const sid = (): number => g.state.activeSectorId;
  const selShip = (): number | null => s.selectedShipId;

  const closeDialog = (): void => {
    if (s.confirm) s.confirm = null;
    else if (s.screen === 'menu') s.menuDialog = null;
    else if (s.pauseDialog) s.pauseDialog = null;
    ui.sfx('ui_close');
  };

  const setSpeed = (speed: SimSpeed): void => {
    ui.settings.set('gameplay.simSpeed', speed);
    if (!ui.pausedByMenu()) g.setSpeed(speed);
    ui.sfx('ui_toggle');
  };

  const a: ActionMap = {
    // ------------------------------------------------------------ Hauptmenü
    'menu-open': (d) => {
      s.menuDialog = (d.dialog as typeof s.menuDialog) ?? null;
      ui.sfx('ui_open');
    },
    'dialog-close': () => closeDialog(),
    'new-game-start': () => {
      const player = (ui.form['new.player'] ?? 'Boss').trim().slice(0, 24) || 'Boss';
      const syn = (ui.form['new.syndicate'] ?? 'Hinterhof-Kartell').trim().slice(0, 32) || 'Hinterhof-Kartell';
      const seedText = (ui.form['new.seed'] ?? '').trim();
      let seed = Math.floor(Math.random() * 2 ** 31);
      if (seedText) {
        const n = Number(seedText);
        if (Number.isFinite(n)) seed = Math.abs(Math.floor(n)) >>> 0;
        else {
          // Text-Seed: einfacher stabiler Hash
          let h = 2166136261;
          for (let i = 0; i < seedText.length; i++) h = Math.imul(h ^ seedText.charCodeAt(i), 16777619);
          seed = h >>> 0;
        }
      }
      g.newGame(seed, { playerName: player, syndicateName: syn });
      ui.sfx('rank_up');
      ui.enterGame();
      ui.toast('info', 'Willkommen in der Slum-Parzelle 01. Fang klein an: Topf, Samen, Wasser.');
    },
    'load-slot': (d) => {
      const r = g.loadFromSlot(d.slot ?? '');
      if (!ui.run(r)) return;
      ui.sfx('ui_open');
      if (s.screen === 'menu') ui.enterGame();
      else {
        s.pauseOpen = false;
        s.pauseDialog = null;
        ui.onStateReplaced();
      }
      ui.toast('good', 'Spielstand geladen.');
    },
    'delete-slot': (d) => {
      const slot = d.slot ?? '';
      const info = g.listSlots().find((x) => x.slot === slot);
      ui.confirm(`Spielstand „${info?.label || slot}" wirklich löschen? Das lässt sich nicht rückgängig machen.`, 'Löschen', () => {
        if (ui.run(g.deleteSlot(slot))) ui.toast('info', 'Spielstand gelöscht.');
      });
    },
    'import-pick': () => ui.pickImportFile(),
    'export-save': () => ui.exportDownload(),

    // ------------------------------------------------------------ Bestätigungen / Meldungen
    'confirm-yes': () => {
      const c = s.confirm;
      s.confirm = null;
      if (c) c.onYes();
    },
    'confirm-no': () => {
      s.confirm = null;
      ui.sfx('ui_close');
    },
    'banner-close': () => {
      ui.banners.shift();
    },

    // ------------------------------------------------------------ Einstellungen
    'settings-tab': (d) => {
      s.settingsTab = (d.tab as typeof s.settingsTab) ?? 'graphics';
      ui.sfx('ui_click');
    },
    'set-setting': (d) => {
      const path = d.path ?? '';
      const raw = d.value ?? '';
      let value: string | number | boolean = raw;
      if (raw === 'true') value = true;
      else if (raw === 'false') value = false;
      else if (raw !== '' && Number.isFinite(Number(raw))) value = Number(raw);
      ui.settings.set(path, value);
      if (!d.live) {
        // Test-Ton nach dem Loslassen eines Lautstärke-Reglers
        if (path === 'audio.ui') ui.sfx('ui_toggle');
        else if (path === 'audio.sfx' || path === 'audio.master') ui.sfx('coins');
        else if (path === 'audio.music') ui.updateMood();
        else ui.sfx('ui_click');
      }
    },
    'set-preset': (d) => {
      ui.settings.applyGraphicsPreset(d.preset as Exclude<GraphicsPreset, 'custom'>);
      ui.sfx('ui_toggle');
    },
    'settings-reset': () => {
      ui.confirm('Alle Einstellungen auf die Standardwerte zurücksetzen?', 'Zurücksetzen', () => {
        ui.settings.reset();
        ui.toast('info', 'Einstellungen zurückgesetzt.');
      });
    },

    // ------------------------------------------------------------ HUD
    view: (d) => ui.setView((d.view as GameView) ?? 'sector'),
    nav: (d) => ui.openPanel((d.panel as LeftPanel) ?? null),
    'panel-close': () => ui.openPanel(null),
    speed: (d) => setSpeed(int(d.speed, 1) as SimSpeed),
    'pause-open': () => ui.setPause(true),
    'pause-close': () => ui.setPause(false),
    'pause-dialog': (d) => {
      s.pauseDialog = (d.dialog as typeof s.pauseDialog) ?? null;
      ui.sfx('ui_open');
    },
    'save-pick': (d, el) => {
      ui.form['save.label'] = d.label ?? '';
      const inp = el.closest('.dialog')?.querySelector<HTMLInputElement>('[data-bind="save.label"]');
      if (inp) inp.value = d.label ?? '';
    },
    'save-confirm': () => {
      const label = (ui.form['save.label'] ?? g.state.syndicateName).trim().slice(0, 40) || 'Spielstand';
      const r = g.saveToSlot(slotFromLabel(label), label);
      if (!ui.run(r)) return;
      s.pauseDialog = null;
      ui.sfx('buy');
      ui.toast('good', `Gespeichert als „${label}".`);
    },
    'to-menu': () => {
      ui.confirm('Zum Hauptmenü zurückkehren? Der aktuelle Stand wird in „Autosave" gespeichert.', 'Zum Hauptmenü', () => ui.exitToMenu());
    },
    'log-toggle': () => {
      s.logOpen = !s.logOpen;
      ui.sfx('ui_click');
    },
    'help-dismiss': () => {
      s.helpDismissed = true;
      ui.savePrefs();
    },
    'help-show': () => {
      s.helpDismissed = false;
      ui.savePrefs();
    },
    hustle: () => {
      const r = g.hustle();
      if (ui.run(r, 'coins') && r.ok) ui.toast('good', `Gelegenheitsjob erledigt: +${cr(r.reward)}`);
    },
    'bribe-officials': () => {
      ui.run(g.bribeOfficials(), 'bribe');
    },
    'cancel-modes': () => {
      ui.cancelModes();
    },
    encounter: (d) => {
      const choice = d.choice as EncounterChoice;
      const r = g.resolveEncounter(int(d.id, -1), choice);
      if (!ui.run(r)) return;
      if (r.ok) {
        const o = r.outcome;
        s.encounterResult = { text: o.text, good: o.success && !o.cargoLost && !o.shipLost, until: performance.now() + 6000 };
      }
      ui.updateMood();
    },

    // ------------------------------------------------------------ Bauen / Sektor
    'build-pick': (d) => {
      const type = d.type as BuildingType;
      if (!BUILDINGS[type]) return;
      if (s.placing === type) {
        ui.cancelModes();
        return;
      }
      if (!g.isUnlocked(type)) {
        ui.toast('warn', 'Dieses Gebäude ist noch nicht freigeschaltet.');
        ui.sfx('ui_error');
        return;
      }
      ui.sfx('ui_click');
      ui.startPlacement(type);
    },
    'place-rotate': () => ui.rotatePlacement(true),
    'demolish-toggle': () => {
      ui.setDemolish(!s.demolish);
      ui.sfx('ui_toggle');
    },
    'sector-pick': (d) => ui.activateSector(int(d.value ?? d.sector, sid()), false),
    'sector-activate': (d) => ui.activateSector(int(d.sector, sid()), true),
    'sector-rename': (d) => {
      const id = int(d.sector, sid());
      const name = (ui.form[`sector.name.${id}`] ?? '').trim();
      if (!name) return;
      if (ui.run(g.renameSector(id, name), 'ui_click')) {
        delete ui.form[`sector.name.${id}`];
        clearActiveInput();
      }
    },
    'buy-sector': (d) => {
      const r = g.buySector(d.type as SectorType);
      if (ui.run(r, 'buy') && r.ok) ui.activateSector(r.sectorId, false);
    },
    tile: (d) => ui.handleTile(int(d.x, -1), int(d.y, -1)),
    'inspect-close': () => ui.selectBuilding(null, null),
    'quick-build': (d) => {
      const t = s.selectedTile;
      const type = d.type as BuildingType;
      if (!t || !BUILDINGS[type]) return;
      const r = g.placeBuilding(sid(), type, t.x, t.y, 0);
      if (ui.run(r) && r.ok) ui.selectBuilding(r.buildingId, t);
    },
    'bulk-water': () => {
      let n = 0;
      for (const b of g.getActiveSector().buildings) if (b.type === 'pot' && b.plant && b.plant.water < 0.98 && g.water(sid(), b.id).ok) n++;
      if (n > 0) {
        ui.sfx('water');
        ui.toast('info', `${n} ${n === 1 ? 'Topf' : 'Töpfe'} gegossen.`);
      } else ui.toast('info', 'Nichts zu gießen.');
    },
    'bulk-harvest': () => {
      let n = 0;
      let units = 0;
      for (const b of [...g.getActiveSector().buildings]) {
        if (b.type !== 'pot' || !b.plant || b.plant.growth < 1) continue;
        const r = g.harvest(sid(), b.id);
        if (r.ok) {
          n++;
          units += r.amount;
        }
      }
      if (n > 0) ui.toast('good', `${n} ${n === 1 ? 'Pflanze' : 'Pflanzen'} geerntet: ${units} Rohware.`);
      else ui.toast('info', 'Noch nichts erntereif.');
    },
    'bulk-plant': (d) => {
      const seed = d.seed as SeedId;
      if (!SEED_IDS.includes(seed)) return;
      let n = 0;
      for (const b of g.getActiveSector().buildings) {
        if (b.type !== 'pot' || b.plant) continue;
        if (g.getItemCount(seed) <= 0) break;
        if (g.plant(sid(), b.id, seed).ok) n++;
      }
      if (n > 0) {
        ui.sfx('plant');
        ui.toast('info', `${n}× ${STRAINS[strainOfSeed(seed)].name} gepflanzt.`);
      } else if (g.getItemCount(seed) <= 0) {
        ui.toast('warn', `Keine ${ITEMS[seed].name} im Lager – im Schwarzmarkt kaufen.`);
        ui.sfx('ui_error');
      } else ui.toast('info', 'Keine leeren Töpfe in diesem Sektor.');
    },

    // ------------------------------------------------------------ Gebäude-Inspektor
    plant: (d) => {
      if (s.selectedBuildingId !== null) ui.run(g.plant(sid(), s.selectedBuildingId, d.seed as SeedId), 'plant');
    },
    water: () => {
      if (s.selectedBuildingId !== null) ui.run(g.water(sid(), s.selectedBuildingId), 'water');
    },
    fertilize: () => {
      if (s.selectedBuildingId !== null) ui.run(g.fertilize(sid(), s.selectedBuildingId), 'craft');
    },
    harvest: () => {
      if (s.selectedBuildingId !== null) ui.run(g.harvest(sid(), s.selectedBuildingId));
    },
    craft: (d) => {
      if (s.selectedBuildingId === null) return;
      const q = int(ui.form['wb.q'], 0);
      const quality = q >= 1 && q <= 3 ? (q as Quality) : undefined;
      ui.run(g.workbenchCraft(sid(), s.selectedBuildingId, d.recipe as RecipeId, quality), 'craft');
    },
    'wb-quality': (d) => {
      ui.form['wb.q'] = d.q ?? '0';
    },
    recipe: (d) => {
      if (s.selectedBuildingId === null) return;
      const id = d.recipe && d.recipe !== 'none' ? (d.recipe as RecipeId) : null;
      ui.run(g.setMachineRecipe(sid(), s.selectedBuildingId, id), 'ui_toggle');
    },
    'machine-load': (d) => {
      if (s.selectedBuildingId === null) return;
      const r = g.machineLoad(sid(), s.selectedBuildingId, d.key ?? '', int(d.n, 10));
      if (ui.run(r, 'ui_click') && r.ok && r.moved === 0) ui.toast('info', 'Der Puffer ist voll oder das Lager leer.');
    },
    'machine-collect': () => {
      if (s.selectedBuildingId === null) return;
      const r = g.machineCollect(sid(), s.selectedBuildingId);
      if (ui.run(r, 'ui_click') && r.ok && r.collected === 0) ui.toast('info', 'Der Ausgangspuffer ist leer.');
    },
    'harvester-seed': (d) => {
      if (s.selectedBuildingId === null) return;
      const seed = d.seed && d.seed !== 'same' ? (d.seed as SeedId) : null;
      ui.run(g.setHarvesterSeed(sid(), s.selectedBuildingId, seed), 'ui_toggle');
    },
    rotate: () => {
      if (s.selectedBuildingId !== null) ui.run(g.rotateBuilding(sid(), s.selectedBuildingId), 'ui_click');
    },
    'demolish-one': () => {
      const id = s.selectedBuildingId;
      if (id === null) return;
      const r = g.removeBuilding(sid(), id);
      if (ui.run(r) && r.ok) {
        ui.selectBuilding(null);
        ui.toast('info', `Abgerissen. Erstattung: ${cr(r.refund)}`);
      }
    },

    // ------------------------------------------------------------ Schwarzmarkt
    'market-tab': (d) => {
      s.marketTab = d.tab === 'inventory' ? 'inventory' : 'buy';
      ui.sfx('ui_click');
    },
    'buy-qty': (d) => {
      s.buyQty = d.qty === 'max' ? 'max' : int(d.qty, 1);
    },
    buy: (d) => {
      const item = d.item as ItemId;
      const offer = g.getShopOffers().find((o) => o.itemId === item);
      if (!offer) return;
      const n = s.buyQty === 'max' ? Math.min(999, Math.floor(g.state.credits / Math.max(1, offer.price))) : s.buyQty;
      if (n <= 0) {
        ui.toast('warn', 'Dafür reichen deine Credits nicht.');
        ui.sfx('ui_error');
        return;
      }
      ui.run(g.buyItem(item, n));
    },
    autobuy: (d) => {
      ui.run(g.setAutoBuy(d.item as ItemId, int(d.value, 0)), 'ui_toggle');
    },
    'sell-qty': (d) => {
      s.sellQty = d.qty === 'all' ? 'all' : int(d.qty, 1);
    },
    sell: (d) => {
      const key = d.key ?? '';
      const have = g.getItemCount(key);
      const n = s.sellQty === 'all' ? have : Math.min(have, s.sellQty);
      if (n <= 0) return;
      ui.run(g.sellLocal(key, n));
    },

    // ------------------------------------------------------------ Werft / Flotte
    'fleet-tab': (d) => {
      s.fleetTab = (d.tab as typeof s.fleetTab) ?? 'yard';
      ui.sfx('ui_click');
    },
    design: (d) => {
      const v = d.value ?? '';
      const next: ShipDesign = { ...s.design };
      if (d.part === 'hull') next.hull = v as ShipDesign['hull'];
      else if (d.part === 'engine') next.engine = int(v, 1) as ShipDesign['engine'];
      else if (d.part === 'cloak') next.cloak = int(v, 0) as ShipDesign['cloak'];
      else if (d.part === 'weapons') next.weapons = int(v, 0) as ShipDesign['weapons'];
      s.design = next;
      ui.sfx('ui_click');
    },
    'build-ship': () => {
      const name = (ui.form['ship.name'] ?? '').trim();
      const r = g.buildShip(s.design, name || undefined);
      if (ui.run(r, 'buy') && r.ok) {
        delete ui.form['ship.name'];
        s.selectedShipId = r.shipId;
        s.fleetTab = 'ships';
      }
    },
    'ship-select': (d) => {
      const id = int(d.ship, -1);
      s.selectedShipId = s.selectedShipId === id ? null : id;
      ui.sfx('ui_click');
    },
    'cargo-qty': (d) => {
      s.cargoQty = d.qty === 'max' ? 'max' : int(d.qty, 1);
    },
    'cargo-load': (d) => {
      const id = selShip();
      if (id === null) return;
      const n = s.cargoQty === 'max' ? 100000 : s.cargoQty;
      const r = g.loadCargo(id, d.key ?? '', n);
      if (ui.run(r, 'ui_click') && r.ok && r.moved === 0) ui.toast('info', 'Der Laderaum ist voll.');
    },
    'cargo-unload': (d) => {
      const id = selShip();
      if (id === null) return;
      ui.run(g.unloadCargo(id, d.key ?? '', s.cargoQty === 'max' ? 100000 : s.cargoQty), 'ui_click');
    },
    'ship-send': (d) => {
      const id = d.ship ? int(d.ship, -1) : selShip();
      if (id === null || id < 0) return;
      const dest = d.system ?? ui.form[`ship.dest.${id}`] ?? '';
      if (!dest) {
        ui.toast('warn', 'Bitte zuerst ein Ziel wählen.');
        return;
      }
      ui.run(g.sendShip(id, dest));
    },
    'ship-home': () => {
      const id = selShip();
      if (id !== null) ui.run(g.sendShip(id, 'sol'));
    },
    'ship-sell': (d) => {
      const id = selShip();
      if (id === null) return;
      const ship = g.getShip(id);
      const have = ship?.cargo[d.key ?? ''] ?? 0;
      const n = s.cargoQty === 'max' ? have : Math.min(have, s.cargoQty);
      if (n > 0) ui.run(g.sellCargo(id, d.key ?? '', n));
    },
    'ship-sell-all': () => {
      const id = selShip();
      const ship = id === null ? undefined : g.getShip(id);
      if (!ship || id === null) return;
      let total = 0;
      let failed = '';
      for (const key of Object.keys(ship.cargo)) {
        const n = ship.cargo[key] ?? 0;
        if (n <= 0) continue;
        const r = g.sellCargo(id, key, n);
        if (r.ok) total += r.revenue;
        else failed = r.reason;
      }
      if (total > 0) ui.toast('good', `Ladung verkauft: +${cr(total)} netto.`);
      else if (failed) {
        ui.toast('warn', failed);
        ui.sfx('ui_error');
      }
    },
    'ship-buy': (d) => {
      const id = selShip();
      if (id === null) return;
      const n = s.cargoQty === 'max' ? 100000 : s.cargoQty;
      ui.run(g.buyGoods(id, d.item as ContrabandId, n));
    },
    'ship-station': () => {
      const id = selShip();
      if (id !== null) ui.run(g.stationShip(id), 'ui_toggle');
    },
    'ship-recall': () => {
      const id = selShip();
      if (id !== null) ui.run(g.recallShip(id), 'ui_toggle');
    },
    'ship-scrap': () => {
      const id = selShip();
      const ship = id === null ? undefined : g.getShip(id);
      if (!ship || id === null) return;
      ui.confirm(`„${ship.name}" wirklich verschrotten? Du bekommst 40 % des Baupreises zurück.`, 'Verschrotten', () => {
        const r = g.scrapShip(id);
        if (ui.run(r, 'demolish') && r.ok) {
          s.selectedShipId = null;
          ui.toast('info', `Verschrottet. Erstattung: ${cr(r.refund)}`);
        }
      });
    },
    'ship-rename': () => {
      const id = selShip();
      if (id === null) return;
      const name = (ui.form[`ship.rename.${id}`] ?? '').trim();
      if (!name) return;
      if (ui.run(g.renameShip(id, name), 'ui_click')) {
        delete ui.form[`ship.rename.${id}`];
        clearActiveInput();
      }
    },
    'ship-locate': (d) => {
      const sys = d.system ?? '';
      if (!sys) return;
      ui.setView('galaxy');
      ui.selectSystem(sys, true);
    },

    // ------------------------------------------------------------ Handelsrouten
    'route-good': (d) => {
      const k = d.good ?? '';
      s.routeGoods[k] = !s.routeGoods[k];
      ui.sfx('ui_click');
    },
    'route-policy': (d) => {
      ui.form['route.policy'] = d.policy ?? 'bribe';
    },
    'ship-open': (d) => {
      s.selectedShipId = int(d.ship, -1);
      s.fleetTab = 'ships';
      s.leftPanel = 'fleet';
      ui.sfx('ui_open');
    },
    'route-create': () => {
      const shipId = int(ui.form['route.ship'], -1);
      const systemId = ui.form['route.system'] ?? '';
      const goods = TRADE_GOOD_IDS.filter((id) => s.routeGoods[id]);
      if (shipId < 0 || !systemId) {
        ui.toast('warn', 'Bitte Schiff und Zielsystem wählen.');
        ui.sfx('ui_error');
        return;
      }
      if (!goods.length) {
        ui.toast('warn', 'Bitte mindestens eine Ware für die Route wählen.');
        ui.sfx('ui_error');
        return;
      }
      const policy = (ui.form['route.policy'] ?? 'bribe') as EncounterChoice;
      const minLoadText = (ui.form['route.minload'] ?? '').trim();
      const minLoad = minLoadText === '' ? undefined : Math.max(1, int(minLoadText, 1));
      const r = g.createRoute({ shipId, systemId, cargo: goods.map((key) => ({ key, amount: 'max' as const })), encounterPolicy: policy, minLoad });
      if (ui.run(r, 'ui_toggle')) {
        delete ui.form['route.ship'];
        delete ui.form['route.minload'];
      }
    },
    'route-toggle': (d) => {
      const id = int(d.route, -1);
      const route = g.state.routes.find((x) => x.id === id);
      if (route) ui.run(g.setRouteEnabled(id, !route.enabled), 'ui_toggle');
    },
    'route-remove': (d) => {
      const id = int(d.route, -1);
      ui.confirm('Diese Handelsroute löschen? Das Schiff kehrt zur manuellen Steuerung zurück.', 'Route löschen', () => {
        ui.run(g.removeRoute(id), 'ui_close');
      });
    },

    // ------------------------------------------------------------ Galaxie / Systeme
    'system-sort': (d) => {
      s.systemSort = (d.sort as typeof s.systemSort) ?? 'distance';
    },
    'system-filter': (d) => {
      ui.form['sys.filter'] = d.filter ?? 'all';
    },
    'system-select': (d) => {
      ui.selectSystem(d.system ?? null, true);
      ui.sfx('ui_click');
    },
    'system-close': () => ui.selectSystem(null, false),
    'system-send': () => {
      const sys = s.selectedSystemId;
      const shipId = int(ui.form['sys.ship'], -1);
      if (!sys) return;
      if (shipId < 0) {
        ui.toast('warn', 'Kein verfügbares Schiff gewählt.');
        ui.sfx('ui_error');
        return;
      }
      ui.run(g.sendShip(shipId, sys));
    },
    sabotage: () => {
      const sys = s.selectedSystemId;
      if (sys) ui.run(g.sabotage(sys));
    },
    protection: () => {
      const sys = s.selectedSystemId;
      if (sys) ui.run(g.payProtection(sys), 'bribe');
    },
    tax: (d) => {
      const sys = s.selectedSystemId;
      if (!sys) return;
      const r = g.setSystemTax(sys, Number(d.value));
      if (!d.live) ui.run(r, 'ui_click');
    },
    'syn-tab': (d) => {
      s.synTab = (d.tab as typeof s.synTab) ?? 'ranking';
      ui.sfx('ui_click');
    },
  };
  return a;
}

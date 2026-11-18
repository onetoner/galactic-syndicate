/**
 * Bilder mit automatischem SVG-Fallback.
 * Higgsfield-Grafiken liegen unter ./assets/ui/<id>.png. Fehlt eine Datei (oder lädt sie nicht),
 * wird automatisch ein sauberes Inline-SVG gezeigt – ohne Code-Änderung.
 */
import { esc } from './dom';

const ASSET_DIR = './assets/ui/';
/** IDs, deren Bild nicht geladen werden konnte -> künftig direkt das SVG verwenden */
const failed = new Set<string>();

const C = { cyan: '#35e0ff', magenta: '#ff3d9a', gold: '#ffc24a', violet: '#a45cff', green: '#4ade80', red: '#ff5d6c', steel: '#9fb0d0', dark: '#0b1020' };

function frame(inner: string, accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><radialGradient id="g" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${accent}" stop-opacity=".28"/><stop offset="1" stop-color="${C.dark}" stop-opacity="1"/></radialGradient></defs>` +
    `<rect width="64" height="64" rx="12" fill="url(#g)"/><rect x="1" y="1" width="62" height="62" rx="11" fill="none" stroke="${accent}" stroke-opacity=".45" stroke-width="1.5"/>` +
    `<g fill="none" stroke="${accent}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`
  );
}

const vial = (fill: string) => `<path d="M26 12h12M28 12v14l-9 20a5 5 0 0 0 5 7h16a5 5 0 0 0 5-7l-9-20V12"/><path d="M23 40h18l4 9a2 2 0 0 1-2 3H21a2 2 0 0 1-2-3z" fill="${fill}" fill-opacity=".55" stroke="none"/>`;
const seeds = (fill: string) => `<ellipse cx="24" cy="38" rx="7" ry="10" transform="rotate(-25 24 38)" fill="${fill}" fill-opacity=".35"/><ellipse cx="41" cy="36" rx="7" ry="10" transform="rotate(20 41 36)" fill="${fill}" fill-opacity=".35"/><ellipse cx="32" cy="24" rx="6" ry="9" fill="${fill}" fill-opacity=".35"/>`;

const GLYPHS: Record<string, [string, string]> = {
  icon_neon_dust: [C.cyan, vial(C.magenta)],
  icon_chrono_spice: [C.gold, `<path d="M20 12h24M20 52h24M22 12c0 12 20 16 20 20s-20 8-20 20M42 12c0 12-20 16-20 20s20 8 20 20"/><circle cx="32" cy="44" r="4" fill="${C.gold}" stroke="none"/>`],
  icon_void_nectar: [C.violet, vial(C.violet)],
  icon_seed_neon: [C.cyan, seeds(C.cyan)],
  icon_seed_chrono: [C.gold, `<path d="M14 34a18 14 0 0 1 36 0z" fill="${C.gold}" fill-opacity=".35"/><path d="M28 34v14a4 4 0 0 0 8 0V34"/><circle cx="24" cy="28" r="1.5"/><circle cx="36" cy="26" r="1.5"/>`],
  icon_seed_void: [C.violet, seeds(C.violet)],
  icon_chem: [C.green, `<path d="M27 12h10M29 12v14L17 48a4 4 0 0 0 4 5h22a4 4 0 0 0 4-5L35 26V12"/><path d="M22 42h20" /><circle cx="29" cy="46" r="1.5"/><circle cx="36" cy="44" r="1.5"/>`],
  icon_nutrient: [C.green, `<path d="M32 10c8 12 14 20 14 28a14 14 0 0 1-28 0c0-8 6-16 14-28z" fill="${C.green}" fill-opacity=".3"/><path d="M26 40a7 7 0 0 0 6 6"/>`],
  icon_packaging: [C.steel, `<path d="M12 22l20-10 20 10v22L32 54 12 44z"/><path d="M12 22l20 10 20-10M32 32v22M22 17l20 10"/>`],
  icon_tech: [C.cyan, `<rect x="20" y="20" width="24" height="24" rx="3"/><rect x="27" y="27" width="10" height="10" fill="${C.cyan}" fill-opacity=".4"/><path d="M26 20v-8M38 20v-8M26 52v-8M38 52v-8M20 26h-8M20 38h-8M52 26h-8M52 38h-8"/>`],
  icon_weapons: [C.red, `<path d="M10 24h34l8 4v6H30l-4 6h-8l2-6h-10z" fill="${C.red}" fill-opacity=".25"/><path d="M24 40l-4 12h10l3-12"/>`],
  icon_module_hull: [C.steel, `<path d="M32 8l12 18v20l-6 8H26l-6-8V26z" fill="${C.steel}" fill-opacity=".2"/><path d="M20 34H12l8-10M44 34h8l-8-10M28 30h8"/>`],
  icon_module_engine: [C.cyan, `<path d="M22 12h20l4 22H18z" fill="${C.steel}" fill-opacity=".2"/><path d="M24 34l-3 10 6-4 5 12 5-12 6 4-3-10" fill="${C.cyan}" fill-opacity=".45"/>`],
  icon_module_cloak: [C.violet, `<circle cx="32" cy="32" r="20" stroke-dasharray="5 6"/><path d="M32 18l10 14-10 14-10-14z" stroke-opacity=".7"/>`],
  icon_module_weapons: [C.magenta, `<path d="M32 8l18 7v14c0 12-8 21-18 27-10-6-18-15-18-27V15z" fill="${C.magenta}" fill-opacity=".18"/><path d="M32 22v20M22 32h20"/>`],
};

const PORTRAIT_COLORS: Record<string, [string, string]> = {
  portrait_player: [C.cyan, 'DU'],
  portrait_police_commander: ['#5b8cff', 'SP'],
  portrait_boss_obsidian: ['#8b5cf6', 'OK'],
  portrait_boss_crimson: ['#ef4444', 'CT'],
  portrait_boss_iron: ['#f59e0b', 'EB'],
  portrait_boss_helix: ['#10b981', 'HZ'],
  portrait_boss_portnull: ['#38bdf8', 'PN'],
};

function portraitSvg(id: string): string {
  const [color, initials] = PORTRAIT_COLORS[id] ?? [C.steel, '?'];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".45"/><stop offset="1" stop-color="${C.dark}"/></linearGradient></defs>` +
    `<rect width="64" height="64" fill="url(#p)"/>` +
    `<circle cx="32" cy="25" r="11" fill="${C.dark}" stroke="${color}" stroke-width="2"/>` +
    `<path d="M10 64c0-14 10-22 22-22s22 8 22 22z" fill="${C.dark}" stroke="${color}" stroke-width="2"/>` +
    `<text x="32" y="59" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" font-weight="700" fill="${color}">${initials}</text></svg>`
  );
}

/** Fallback-SVG als Text für eine iconId/portraitId (generisches Symbol für Unbekanntes). */
export function fallbackSvg(id: string): string {
  if (id.startsWith('portrait_')) return portraitSvg(id);
  const g = GLYPHS[id];
  if (g) return frame(g[1], g[0]);
  return frame(`<circle cx="32" cy="32" r="16"/><path d="M32 24v10M32 40v1"/>`, C.steel);
}

export function fallbackDataUrl(id: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(fallbackSvg(id))}`;
}

function img(id: string, cls: string, alt: string): string {
  const src = failed.has(id) ? fallbackDataUrl(id) : `${ASSET_DIR}${encodeURIComponent(id)}.png`;
  return `<img class="${cls}" src="${src}" alt="${esc(alt)}" data-fb="${esc(id)}" draggable="false" decoding="async">`;
}

/** Item-/Modul-Icon. */
export function icon(iconId: string, alt = '', cls = ''): string {
  return img(iconId, `ico ${cls}`.trim(), alt);
}

/** Charakter-Porträt. */
export function portrait(portraitId: string, alt = '', cls = ''): string {
  return img(portraitId, `portrait ${cls}`.trim(), alt);
}

/**
 * Einmal am UI-Wurzelelement installieren: fängt Ladefehler aller <img data-fb> ab
 * (error-Events blubbern nicht -> Capture-Phase) und ersetzt sie durch das SVG.
 */
export function installImageFallback(root: HTMLElement): void {
  root.addEventListener(
    'error',
    (ev) => {
      const t = ev.target;
      if (!(t instanceof HTMLImageElement)) return;
      const id = t.dataset.fb;
      if (!id || t.dataset.fbDone) return;
      failed.add(id);
      t.dataset.fbDone = '1';
      t.src = fallbackDataUrl(id);
    },
    true,
  );
}

export function imageFallbackCount(): number {
  return failed.size;
}

// ---------------------------------------------------------------- Gebäude-Symbole (Baumenü, Minikarte)

const B: Record<string, string> = {
  pot: `<path d="M5 9h14l-2 10H7z"/><path d="M4 9h16"/><path d="M12 9V5m0 0c-2 0-3-1-3-2m3 2c2 0 3-1 3-2"/>`,
  grow_lamp: `<path d="M5 4h14l-2 4H7z"/><path d="M12 8v11M8 20h8"/><path d="M8 11l-1 2M12 12v2M16 11l1 2" stroke-opacity=".7"/>`,
  workbench: `<path d="M3 9h18M5 9v11M19 9v11M5 15h14"/><path d="M9 9V6h4v3"/>`,
  auto_waterer: `<path d="M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z"/><path d="M4 21h16"/>`,
  auto_harvester: `<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M6 6h12M12 6v6"/><rect x="9" y="12" width="6" height="4" rx="1"/><path d="M5 21h14"/>`,
  synth_lab: `<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 16h8"/>`,
  packaging_line: `<path d="M3 17h18M5 17v3M19 17v3"/><rect x="6" y="9" width="6" height="6"/><path d="M15 6v9M13 6h4"/>`,
  storage_crate: `<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M9 5v14M15 5v14"/>`,
  conveyor: `<path d="M3 8h18v8H3z"/><path d="M7 14l3-2-3-2M12 14l3-2-3-2"/>`,
};

/** Inline-SVG-Symbol für einen Gebäudetyp (currentColor). */
export function buildingIcon(type: string, cls = ''): string {
  const d = B[type] ?? `<rect x="5" y="5" width="14" height="14" rx="2"/>`;
  return `<svg class="bico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

const UI_GLYPHS: Record<string, string> = {
  build: `<path d="M14 6l4 4-9 9H5v-4z"/><path d="M13 7l4 4"/>`,
  market: `<path d="M4 8h16l-1.5 11h-13z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>`,
  fleet: `<path d="M12 3l4 8v6l-4 4-4-4v-6z"/><path d="M8 13l-4 3M16 13l4 3"/>`,
  systems: `<circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="1.5"/><circle cx="19" cy="7" r="1.5"/><circle cx="17" cy="19" r="1.5"/><path d="M6.3 7l3.3 3M17.7 8l-3.3 2.3M16 18l-2.3-3.6"/>`,
  syndicates: `<path d="M4 18l2-9 4 4 2-7 2 7 4-4 2 9z"/><path d="M4 21h16"/>`,
  sector: `<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/>`,
  planet: `<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16"/>`,
  galaxy: `<path d="M12 12c0-5 5-7 8-5M12 12c5 0 7 5 5 8M12 12c0 5-5 7-8 5M12 12c-5 0-7-5-5-8"/><circle cx="12" cy="12" r="1.5"/>`,
  pause: `<path d="M8 5v14M16 5v14"/>`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16"/>`,
  log: `<path d="M5 5h14v14H5z"/><path d="M8 9h8M8 12h8M8 15h5"/>`,
  close: `<path d="M6 6l12 12M18 6L6 18"/>`,
  job: `<path d="M4 9h16v10H4z"/><path d="M9 9V6h6v3"/>`,
  heat: `<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-6 1-9z"/>`,
  help: `<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.5"/>`,
};

export function uiIcon(name: string, cls = ''): string {
  const d = UI_GLYPHS[name] ?? UI_GLYPHS.help!;
  return `<svg class="uico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

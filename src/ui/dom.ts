/**
 * Kleine HTML-Bausteine für das UI. Das UI wird als HTML-Text erzeugt und per Event-Delegation bedient
 * (`data-action` + `data-*`-Argumente). Alle Werte, die in HTML landen, laufen durch `esc`.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c] as string);
}

type AttrValue = string | number | boolean | null | undefined;

export function attrs(o: Record<string, AttrValue>): string {
  let out = '';
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === null || v === undefined || v === false) continue;
    out += v === true ? ` ${k}` : ` ${k}="${esc(v)}"`;
  }
  return out;
}

function dataAttrs(data?: Record<string, AttrValue>): Record<string, AttrValue> {
  const out: Record<string, AttrValue> = {};
  if (data) for (const k of Object.keys(data)) out[`data-${k}`] = data[k];
  return out;
}

/** Stabile Test-ID aus Aktion + Argumenten, z. B. "nav-market" oder "buy-seed_neon". */
export function testId(action: string, data?: Record<string, AttrValue>): string {
  const parts = [action];
  if (data) for (const k of Object.keys(data)) if (data[k] !== undefined && data[k] !== null && data[k] !== '') parts.push(String(data[k]));
  return parts.join('-').replace(/[^A-Za-z0-9_-]+/g, '_');
}

export interface BtnOpts {
  label: string;
  action: string;
  data?: Record<string, AttrValue>;
  cls?: string;
  disabled?: boolean;
  tip?: string;
  testid?: string;
  active?: boolean;
  /** Inhalt ist bereits HTML (z. B. mit Icon) */
  html?: boolean;
}

let touchMode = false;

/**
 * Touch-Bedienung: deaktivierte Buttons behalten nur `aria-disabled` (kein `disabled`-Attribut),
 * damit ein Antippen den Hinweis zeigen kann, warum die Aktion gerade nicht möglich ist.
 */
export function setTouchMode(on: boolean): void {
  touchMode = on;
}

export function btn(o: BtnOpts): string {
  const cls = `btn ${o.cls ?? ''}${o.active ? ' is-active' : ''}${o.disabled && touchMode ? ' is-disabled' : ''}`.trim();
  return `<button type="button"${attrs({
    class: cls,
    'data-action': o.action,
    ...dataAttrs(o.data),
    'data-testid': o.testid ?? testId(o.action, o.data),
    'data-tip': o.tip,
    'aria-pressed': o.active === undefined ? undefined : String(o.active),
    'aria-disabled': o.disabled ? 'true' : undefined,
    disabled: o.disabled && !touchMode,
  })}>${o.html ? o.label : esc(o.label)}</button>`;
}

export interface InputOpts {
  bind: string;
  value: string | number;
  placeholder?: string;
  type?: 'text' | 'number';
  testid?: string;
  min?: number;
  max?: number;
  maxlength?: number;
  cls?: string;
  label?: string;
}

export function input(o: InputOpts): string {
  return `<input${attrs({
    class: `inp ${o.cls ?? ''}`.trim(),
    type: o.type ?? 'text',
    value: o.value,
    placeholder: o.placeholder,
    min: o.min,
    max: o.max,
    maxlength: o.maxlength ?? 40,
    'data-bind': o.bind,
    'data-testid': o.testid ?? `input-${o.bind.replace(/[^A-Za-z0-9_-]+/g, '_')}`,
    'aria-label': o.label ?? o.placeholder,
    // Bildschirmtastatur: Ziffernblock für Zahlen, „Fertig" statt Zeilenumbruch
    inputmode: o.type === 'number' ? 'numeric' : undefined,
    enterkeyhint: 'done',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
  })}>`;
}

export interface SelectOpts {
  /** speichert den Wert in ui.form[bind] */
  bind?: string;
  /** zusätzlich/alternativ: Aktion beim Ändern (Wert in data.value) */
  action?: string;
  data?: Record<string, AttrValue>;
  value: string | number;
  options: { value: string | number; label: string; disabled?: boolean }[];
  testid?: string;
  label?: string;
  cls?: string;
}

export function select(o: SelectOpts): string {
  const opts = o.options
    .map((op) => `<option${attrs({ value: op.value, selected: String(op.value) === String(o.value), disabled: op.disabled })}>${esc(op.label)}</option>`)
    .join('');
  return `<select${attrs({
    class: `sel ${o.cls ?? ''}`.trim(),
    'data-bind': o.bind,
    'data-action': o.action,
    ...dataAttrs(o.data),
    'data-testid': o.testid ?? (o.bind ? `select-${o.bind.replace(/[^A-Za-z0-9_-]+/g, '_')}` : testId(o.action ?? 'select', o.data)),
    'aria-label': o.label,
  })}>${opts}</select>`;
}

export interface RangeOpts {
  action: string;
  data?: Record<string, AttrValue>;
  value: number;
  min: number;
  max: number;
  step: number;
  testid?: string;
  label?: string;
}

export function range(o: RangeOpts): string {
  return `<input${attrs({
    class: 'rng',
    type: 'range',
    min: o.min,
    max: o.max,
    step: o.step,
    value: o.value,
    'data-action': o.action,
    ...dataAttrs(o.data),
    'data-testid': o.testid ?? testId(o.action, o.data),
    'aria-label': o.label,
  })}>`;
}

export function bar(value01: number, cls = '', label = ''): string {
  const v = Math.round(Math.min(1, Math.max(0, Number.isFinite(value01) ? value01 : 0)) * 1000) / 10;
  return `<div class="bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(v)}"${label ? ` aria-label="${esc(label)}"` : ''}><i style="width:${v}%"></i></div>`;
}

export function kv(key: string, valueHtml: string, tip?: string): string {
  return `<div class="kv"${tip ? ` data-tip="${esc(tip)}"` : ''}><span>${esc(key)}</span><b>${valueHtml}</b></div>`;
}

// ---------------------------------------------------------------- Formatierung

const NF0 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

export function num(n: number): string {
  return NF0.format(Number.isFinite(n) ? Math.round(n) : 0);
}

/** Credits kompakt: 950, 12.400, 1,3 Mio., 2,1 Mrd. */
export function cr(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const a = Math.abs(v);
  if (a >= 1e9) return `${NF1.format(v / 1e9)} Mrd. ₡`;
  if (a >= 1e7) return `${NF1.format(v / 1e6)} Mio. ₡`;
  return `${NF0.format(Math.round(v))} ₡`;
}

export function pct(v01: number, digits = 0): string {
  const v = (Number.isFinite(v01) ? v01 : 0) * 100;
  return `${digits > 0 ? NF1.format(v) : NF0.format(Math.round(v))} %`;
}

/** Sekunden als m:ss bzw. h:mm:ss */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function dateTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '–';
  try {
    return new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '–';
  }
}

export function qualityStars(q: number): string {
  if (!q) return '';
  return `<span class="q q${q}" aria-label="Qualität ${q} von 3">${'◆'.repeat(q)}${'◇'.repeat(3 - q)}</span>`;
}

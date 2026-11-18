/**
 * Minimales DOM-Morphing: gleicht einen bestehenden DOM-Baum an neues HTML an, statt ihn zu ersetzen.
 * Elemente bleiben erhalten, solange Tag und data-testid übereinstimmen – dadurch überleben Fokus, Hover,
 * geöffnete Auswahllisten, Scroll-Positionen und laufende Klicks die häufigen UI-Aktualisierungen (≈5×/s).
 */

function sameNode(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) return false;
  if (a.nodeType !== Node.ELEMENT_NODE) return true;
  const ea = a as Element;
  const eb = b as Element;
  return ea.tagName === eb.tagName && ea.getAttribute('data-testid') === eb.getAttribute('data-testid');
}

function syncAttributes(cur: Element, next: Element): void {
  const curAttrs = cur.attributes;
  for (let i = curAttrs.length - 1; i >= 0; i--) {
    const name = (curAttrs[i] as Attr).name;
    if (!next.hasAttribute(name)) cur.removeAttribute(name);
  }
  const nextAttrs = next.attributes;
  for (let i = 0; i < nextAttrs.length; i++) {
    const a = nextAttrs[i] as Attr;
    if (cur.getAttribute(a.name) !== a.value) cur.setAttribute(a.name, a.value);
  }
}

function morphElement(cur: Element, next: Element): void {
  syncAttributes(cur, next);
  const focused = document.activeElement === cur;

  if (cur instanceof HTMLInputElement) {
    // Attribut-Änderungen erreichen "schmutzige" Felder nicht -> Property nachziehen, außer der Nutzer tippt/zieht gerade
    if (!focused && cur.type !== 'file') {
      const v = next.getAttribute('value') ?? '';
      if (cur.value !== v) cur.value = v;
      if (cur.type === 'checkbox' || cur.type === 'radio') cur.checked = next.hasAttribute('checked');
    }
    return;
  }
  if (cur instanceof HTMLTextAreaElement) {
    if (!focused && cur.value !== (next.textContent ?? '')) cur.value = next.textContent ?? '';
    return;
  }

  morphChildren(cur, next);

  if (cur instanceof HTMLSelectElement && !focused) {
    const sel = next.querySelector('option[selected]');
    const v = sel ? (sel.getAttribute('value') ?? sel.textContent ?? '') : null;
    if (v !== null && cur.value !== v) cur.value = v;
  }
}

export function morphChildren(parent: Node, next: Node): void {
  let cur = parent.firstChild;
  let nx = next.firstChild;
  while (nx) {
    const nxNext = nx.nextSibling;
    if (!cur) {
      parent.appendChild(nx);
    } else if (sameNode(cur, nx)) {
      if (cur.nodeType === Node.ELEMENT_NODE) morphElement(cur as Element, nx as Element);
      else if (cur.nodeValue !== nx.nodeValue) cur.nodeValue = nx.nodeValue;
      cur = cur.nextSibling;
    } else {
      const old = cur;
      cur = cur.nextSibling;
      parent.replaceChild(nx, old);
    }
    nx = nxNext;
  }
  while (cur) {
    const rest = cur.nextSibling;
    parent.removeChild(cur);
    cur = rest;
  }
}

const template = typeof document !== 'undefined' ? document.createElement('template') : null;

/** Inhalt von `el` an `html` angleichen. */
export function morphHtml(el: Element, html: string): void {
  if (!template) {
    el.innerHTML = html;
    return;
  }
  template.innerHTML = html;
  morphChildren(el, template.content);
  template.innerHTML = '';
}

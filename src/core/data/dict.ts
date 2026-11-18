/**
 * Daten-Tabelle ohne Prototyp.
 * Damit treffen `id in TABELLE` und `TABELLE[id]` nie auf geerbte Schlüssel wie "constructor" oder "toString" –
 * unbekannte IDs aus Kommandos oder defekten Spielständen werden zuverlässig als unbekannt erkannt.
 */
export function dict<T extends object>(table: T): T {
  return Object.assign(Object.create(null) as T, table);
}

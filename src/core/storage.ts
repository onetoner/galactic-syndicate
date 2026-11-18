// Speicher-Abstraktion: im Browser LocalStorage, in Tests/Headless ein In-Memory-Speicher.

export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  keys(): string[];
}

export class MemoryStorage implements KVStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  keys(): string[] {
    return Array.from(this.data.keys());
  }
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** Wrappt globalThis.localStorage defensiv. Ist er nicht verfügbar (Node, Privatmodus), wird im Speicher gehalten. */
export class BrowserStorage implements KVStorage {
  private fallback = new MemoryStorage();
  private ls: StorageLike | null = null;

  constructor() {
    try {
      const candidate = (globalThis as { localStorage?: StorageLike }).localStorage;
      if (candidate) {
        const probe = '__gs_probe__';
        candidate.setItem(probe, '1');
        candidate.removeItem(probe);
        this.ls = candidate;
      }
    } catch {
      this.ls = null;
    }
  }

  /** true, wenn wirklich persistent gespeichert wird */
  get persistent(): boolean {
    return this.ls !== null;
  }

  getItem(key: string): string | null {
    try {
      return this.ls ? this.ls.getItem(key) : this.fallback.getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }
  setItem(key: string, value: string): void {
    try {
      if (this.ls) this.ls.setItem(key, value);
      else this.fallback.setItem(key, value);
    } catch {
      this.fallback.setItem(key, value);
    }
  }
  removeItem(key: string): void {
    try {
      if (this.ls) this.ls.removeItem(key);
    } catch {
      /* ignorieren */
    }
    this.fallback.removeItem(key);
  }
  keys(): string[] {
    const out = new Set<string>(this.fallback.keys());
    try {
      if (this.ls) {
        for (let i = 0; i < this.ls.length; i++) {
          const k = this.ls.key(i);
          if (k !== null) out.add(k);
        }
      }
    } catch {
      /* ignorieren */
    }
    return Array.from(out);
  }
}

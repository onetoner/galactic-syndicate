// Typisierter, synchroner Event-Bus.

export type Listener<T> = (payload: T) => void;

export class EventBus<E extends object> {
  private listeners: { [K in keyof E]?: Listener<E[K]>[] } = {};
  private anyListeners: ((name: keyof E, payload: E[keyof E]) => void)[] = [];

  /** Registriert einen Listener. Rückgabe: Funktion zum Abmelden. */
  on<K extends keyof E>(name: K, fn: Listener<E[K]>): () => void {
    const list = (this.listeners[name] ??= []);
    list.push(fn);
    return () => this.off(name, fn);
  }

  off<K extends keyof E>(name: K, fn: Listener<E[K]>): void {
    const list = this.listeners[name];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  /** Listener für alle Events (z. B. für UI-Refresh oder Audio). */
  onAny(fn: (name: keyof E, payload: E[keyof E]) => void): () => void {
    this.anyListeners.push(fn);
    return () => {
      const i = this.anyListeners.indexOf(fn);
      if (i >= 0) this.anyListeners.splice(i, 1);
    };
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const list = this.listeners[name];
    if (list) for (const fn of list.slice()) fn(payload);
    if (this.anyListeners.length) for (const fn of this.anyListeners.slice()) fn(name, payload);
  }

  clear(): void {
    this.listeners = {};
    this.anyListeners = [];
  }
}

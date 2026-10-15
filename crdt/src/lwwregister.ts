import type { Crdt } from './crdt.ts';

// LWW-Register: guarda un valor (de cualquier tipo) y su timestamp. Join: el de timestamp mayor; con timestamps
// iguales, el de JSON mayor (un desempate arbitrario, pero el mismo en todas las réplicas).
export class LWWRegister<V> implements Crdt<LWWRegister<V>, V> {
  // Bottom: timestamp -Infinity, así que cualquier write le gana. Un static no puede usar V, así que es any.
  static bottom: LWWRegister<any> = new LWWRegister(null, -Infinity);

  private current: V;
  private timestamp: number;

  private constructor(current: V, timestamp: number) {
    this.current = current;
    this.timestamp = timestamp;
  }

  // Un write es un join con el par nuevo: si su timestamp es más viejo, no cambia nada (inflationary)
  set(value: V, timestamp: number): LWWRegister<V> {
    return this.join(new LWWRegister(value, timestamp));
  }

  join(crdt: LWWRegister<V>): LWWRegister<V> {
    const sameTimestamp = crdt.timestamp === this.timestamp;
    const crdtIsNewer = crdt.timestamp > this.timestamp
      // Desempate determinístico: con timestamps iguales, gana el JSON mayor
      || (sameTimestamp && JSON.stringify(crdt.current) > JSON.stringify(this.current));
    if (crdtIsNewer) {
      return crdt;
    } else {
      return this;
    }
  }

  value(): V {
    return this.current;
  }

  equals(crdt: LWWRegister<V>): boolean {
    return this.timestamp === crdt.timestamp && JSON.stringify(this.current) === JSON.stringify(crdt.current);
  }
}

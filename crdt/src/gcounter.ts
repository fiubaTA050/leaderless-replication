import type { Crdt } from './crdt.ts';
import { joinMaps, equalMaps } from './commons/maps.ts';

// G-Counter (grow-only): cada réplica cuenta sus propios incrementos.
// Estado: Map replicaId -> cantidad. Orden: componente a componente. Join: máximo por réplica.
export class GCounter implements Crdt<GCounter, number> {
  static bottom = new GCounter(new Map());

  private counts: Map<string, number>;

  private constructor(counts: Map<string, number>) {
    this.counts = counts;
  }

  // Una réplica solo incrementa su propia entrada
  increment(replicaId: string, amount = 1): GCounter {
    if (amount < 0) {
      throw new Error('Un G-Counter solo crece');
    } else {
      return new GCounter(new Map(this.counts).set(replicaId, (this.counts.get(replicaId) ?? 0) + amount));
    }
  }

  join(crdt: GCounter): GCounter {
    return new GCounter(joinMaps(this.counts, crdt.counts, Math.max));
  }

  value(): number {
    return [...this.counts.values()].reduce((sum, n) => sum + n, 0);
  }

  equals(crdt: GCounter): boolean {
    return equalMaps(this.counts, crdt.counts, (x, y) => x === y);
  }
}

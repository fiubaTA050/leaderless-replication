import type { Crdt } from './crdt.ts';
import { GCounter } from './gcounter.ts';

// PN-Counter: dos G-Counters, uno de incrementos (positive) y otro de decrementos (negative).
// Valor: positive - negative. Join: join de cada G-Counter por separado.
export class PNCounter implements Crdt<PNCounter, number> {
  static bottom = new PNCounter(GCounter.bottom, GCounter.bottom);

  private positive: GCounter;
  private negative: GCounter;

  private constructor(positive: GCounter, negative: GCounter) {
    this.positive = positive;
    this.negative = negative;
  }

  increment(replicaId: string, amount = 1): PNCounter {
    return new PNCounter(this.positive.increment(replicaId, amount), this.negative);
  }

  // Decrementar es incrementar el G-Counter negative: el estado sigue creciendo
  decrement(replicaId: string, amount = 1): PNCounter {
    return new PNCounter(this.positive, this.negative.increment(replicaId, amount));
  }

  join(crdt: PNCounter): PNCounter {
    return new PNCounter(this.positive.join(crdt.positive), this.negative.join(crdt.negative));
  }

  value(): number {
    return this.positive.value() - this.negative.value();
  }

  equals(crdt: PNCounter): boolean {
    return this.positive.equals(crdt.positive) && this.negative.equals(crdt.negative);
  }
}

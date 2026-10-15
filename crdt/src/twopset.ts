import type { Crdt } from './crdt.ts';
import { GSet } from './gset.ts';

// 2P-Set (two-phase set): un G-Set de agregados y otro de borrados (tombstones).
// Un elemento borrado no se puede volver a agregar: remove gana para siempre.
export class TwoPSet implements Crdt<TwoPSet, Set<string>> {
  static bottom = new TwoPSet(GSet.bottom, GSet.bottom);

  private added: GSet;
  private removed: GSet;

  private constructor(added: GSet, removed: GSet) {
    this.added = added;
    this.removed = removed;
  }

  add(element: string): TwoPSet {
    return new TwoPSet(this.added.add(element), this.removed);
  }

  // Solo se puede borrar algo que está
  remove(element: string): TwoPSet {
    if (this.value().has(element)) {
      return new TwoPSet(this.added, this.removed.add(element));
    } else {
      return this;
    }
  }

  join(crdt: TwoPSet): TwoPSet {
    return new TwoPSet(this.added.join(crdt.added), this.removed.join(crdt.removed));
  }

  value(): Set<string> {
    return this.added.value().difference(this.removed.value());
  }

  equals(crdt: TwoPSet): boolean {
    return this.added.equals(crdt.added) && this.removed.equals(crdt.removed);
  }
}

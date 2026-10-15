import type { Crdt } from './crdt.ts';

// G-Set (grow-only set): solo se puede agregar. Orden: ⊆. Join: unión.
export class GSet implements Crdt<GSet, Set<string>> {
  static bottom = new GSet(new Set());

  private elements: Set<string>;

  private constructor(elements: Set<string>) {
    this.elements = elements;
  }

  add(element: string): GSet {
    return new GSet(this.elements.union(new Set([element])));
  }

  join(crdt: GSet): GSet {
    return new GSet(this.elements.union(crdt.elements));
  }

  value(): Set<string> {
    return this.elements;
  }

  equals(crdt: GSet): boolean {
    return this.elements.symmetricDifference(crdt.elements).size === 0;
  }
}

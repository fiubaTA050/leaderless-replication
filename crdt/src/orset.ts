import type { Crdt } from './crdt.ts';
import { type Tags, unionMaps, addTags, tagsOf, nextTag, equalTags } from './commons/tags.ts';

// OR-Set (observed-remove set), add wins.
// Cada add crea un tag único. Un remove marca como borrados (tombstones) solo los tags que observó, así que un
// add concurrente (con un tag que el remove no vio) sobrevive.
// Estado: adds y removes, cada uno Map<elemento, Set<tag>>.
export class ORSet implements Crdt<ORSet, Set<string>> {
  static bottom = new ORSet(new Map(), new Map());

  private adds: Tags;
  private removes: Tags;

  private constructor(adds: Tags, removes: Tags) {
    this.adds = adds;
    this.removes = removes;
  }

  add(element: string, replicaId: string): ORSet {
    const tag = nextTag(tagsOf(this.adds, element), replicaId);
    return new ORSet(addTags(this.adds, element, [tag]), this.removes);
  }

  remove(element: string): ORSet {
    return new ORSet(this.adds, addTags(this.removes, element, this.liveTags(element)));
  }

  join(crdt: ORSet): ORSet {
    return new ORSet(unionMaps(this.adds, crdt.adds), unionMaps(this.removes, crdt.removes));
  }

  // Está si tiene algún tag de add sin tombstone
  value(): Set<string> {
    return new Set([...this.adds.keys()].filter((element) => this.liveTags(element).size > 0));
  }

  equals(crdt: ORSet): boolean {
    return equalTags(this.adds, crdt.adds) && equalTags(this.removes, crdt.removes);
  }

  // Tags de add de un elemento que no tienen tombstone
  private liveTags(element: string): Set<string> {
    return tagsOf(this.adds, element).difference(tagsOf(this.removes, element));
  }
}

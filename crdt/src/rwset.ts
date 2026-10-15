import type { Crdt } from './crdt.ts';
import { type Tags, unionMaps, addTags, tagsOf, nextTag, equalTags } from './commons/tags.ts';

// Remove-wins set: simétrico al OR-Set.
// - add crea un tag de add y cancela los tags de remove que observó.
// - remove crea un tag de remove y cancela los tags de add que observó.
// Está si tiene algún tag de add vivo y ningún tag de remove vivo: con add y remove concurrentes, gana remove.
// Estado: adds, removes y tombstones (tags cancelados), cada uno Map<elemento, Set<tag>>.
export class RWSet implements Crdt<RWSet, Set<string>> {
  static bottom = new RWSet(new Map(), new Map(), new Map());

  private adds: Tags;
  private removes: Tags;
  private tombstones: Tags;

  private constructor(adds: Tags, removes: Tags, tombstones: Tags) {
    this.adds = adds;
    this.removes = removes;
    this.tombstones = tombstones;
  }

  add(element: string, replicaId: string): RWSet {
    return new RWSet(
      addTags(this.adds, element, [this.newTag(element, replicaId)]),
      this.removes,
      addTags(this.tombstones, element, this.live(this.removes, element)),
    );
  }

  remove(element: string, replicaId: string): RWSet {
    return new RWSet(
      this.adds,
      addTags(this.removes, element, [this.newTag(element, replicaId)]),
      addTags(this.tombstones, element, this.live(this.adds, element)),
    );
  }

  join(crdt: RWSet): RWSet {
    return new RWSet(
      unionMaps(this.adds, crdt.adds),
      unionMaps(this.removes, crdt.removes),
      unionMaps(this.tombstones, crdt.tombstones),
    );
  }

  value(): Set<string> {
    return new Set([...this.adds.keys()].filter((element) =>
      this.live(this.adds, element).size > 0 && this.live(this.removes, element).size === 0));
  }

  equals(crdt: RWSet): boolean {
    return equalTags(this.adds, crdt.adds)
      && equalTags(this.removes, crdt.removes)
      && equalTags(this.tombstones, crdt.tombstones);
  }

  // Tag nuevo para un elemento: no repite ningún tag de add ni de remove de esa réplica
  private newTag(element: string, replicaId: string): string {
    return nextTag(tagsOf(this.adds, element).union(tagsOf(this.removes, element)), replicaId);
  }

  // Tags de un elemento (de add o de remove) que no fueron cancelados
  private live(map: Tags, element: string): Set<string> {
    return tagsOf(map, element).difference(tagsOf(this.tombstones, element));
  }
}

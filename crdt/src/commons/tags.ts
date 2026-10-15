import { joinMaps, equalMaps } from './maps.ts';

// Helpers para los sets con tags: Map<elemento, Set<tag>>. Nunca se modifican: devuelven un Map nuevo.
export type Tags = Map<string, Set<string>>;

// Unión de dos Map<elemento, Set<tag>>: si un elemento está en los dos, se unen sus tags
export function unionMaps(a: Tags, b: Tags): Tags {
  return joinMaps(a, b, (x, y) => x.union(y));
}

// Mismos elementos, y cada uno con los mismos tags
export function equalTags(a: Tags, b: Tags): boolean {
  return equalMaps(a, b, (x, y) => x.symmetricDifference(y).size === 0);
}

// Agrega tags a un elemento
export function addTags(map: Tags, element: string, tags: Iterable<string>): Tags {
  return unionMaps(map, new Map([[element, new Set(tags)]]));
}

export function tagsOf(map: Tags, element: string): Set<string> {
  return map.get(element) ?? new Set<string>();
}

// Tag determinístico `${replicaId}:${n}`: n es uno más que el mayor n que ya usó esa réplica en estos tags
export function nextTag(tags: Set<string>, replicaId: string): string {
  const used = [...tags]
    .filter((tag) => tag.startsWith(`${replicaId}:`))
    .map((tag) => Number(tag.slice(replicaId.length + 1)));
  return `${replicaId}:${Math.max(0, ...used) + 1}`;
}

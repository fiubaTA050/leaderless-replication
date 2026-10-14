// Join de dos Map: el resultado tiene las claves de los dos. Si una clave está en los dos, sus valores se combinan
// con joinValues (que tiene que ser un join: conmutativo, asociativo e idempotente).
export function joinMaps<K, V>(a: Map<K, V>, b: Map<K, V>, joinValues: (x: V, y: V) => V): Map<K, V> {
  const result = new Map(a);
  for (const [key, value] of b) {
    if (result.has(key)) {
      result.set(key, joinValues(result.get(key)!, value));
    } else {
      result.set(key, value);
    }
  }
  return result;
}

// Dos Map son iguales si tienen las mismas claves y, para cada clave, valores iguales según equalValues
export function equalMaps<K, V>(a: Map<K, V>, b: Map<K, V>, equalValues: (x: V, y: V) => boolean): boolean {
  return a.size === b.size && [...a].every(([key, value]) => b.has(key) && equalValues(value, b.get(key)!));
}

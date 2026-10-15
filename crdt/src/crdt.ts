// CRDT state-based: un estado que es un elemento de un join-semilattice. Cada CRDT es una clase con:
// - static bottom: el estado inicial de cada réplica (ninguna réplica escribió nada). Una interface no puede
//   declarar miembros static, así que cada clase define el suyo.
// - join: combina dos estados; es conmutativo, asociativo e idempotente, con bottom como neutro
// - value: lo que ve la aplicación
// Los estados no se modifican: cada update devuelve un estado nuevo, mayor o igual en el orden. Por eso todas las
// réplicas comparten la misma instancia de bottom. Los constructores son private: fuera de la clase, todo estado
// empieza en X.bottom y cambia con updates.
export interface Crdt<T, V> {
  join(crdt: T): T;
  value(): V;
  // Solo para los tests: compara el estado completo, no solo value()
  equals(crdt: T): boolean;
}

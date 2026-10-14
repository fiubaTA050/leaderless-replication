# Replicación leaderless

Dependencias y secuencia completa de la clase: [`main`](https://github.com/fiubaTA050/leaderless-replication/tree/main).

## Parte 4: CRDTs

### Branch `6-crdt-counters`: law testing y counters

```bash
git checkout 6-crdt-counters
cd crdt
npm install
npm test
```

#### Law testing

En `5-crdt-lww` escribimos cada propiedad a mano. Esas propiedades son las **leyes** del join, y son las mismas
para todo CRDT, así que `test/commons/laws.ts` las agrupa en `testCrdtLaws(name, Clase, params, apply)`: join
conmutativo, asociativo e idempotente, y `Clase.bottom` neutro del join. Sirve para cualquier clase que implemente
`Crdt` y tenga un `static bottom`. Los estados de prueba los arma `testCrdtLaws`: genera una lista de `params` al
azar y los aplica en orden desde `Clase.bottom` con `apply`.

Las leyes comparan estados con `equals`, no con `value()`: `{a → 2}` y `{b → 2}` tienen el mismo valor pero son
estados distintos, y lo que tiene que converger es el estado (es lo que las réplicas se mandan y combinan después).

#### G-Counter

Un LWW-Register no sirve para contar: dos réplicas leen 0 y escriben 1 a la vez, y el join da 1, no 2.

`src/gcounter.ts`: un `Map` con una entrada por réplica (`a → 2, b → 3`). Cada réplica solo incrementa su propia
entrada (`increment(replicaId, amount)`), así que el máximo de cada entrada es el valor correcto. Valor: la suma de
las entradas. Orden: componente a componente. Join: máximo por réplica.

El join usa `joinMaps(a, b, joinValues)` de `src/commons/maps.ts`: el resultado tiene las claves de los dos maps, y si
una clave está en los dos, combina los valores con `joinValues`. El G-Counter lo usa con `Math.max`:

```ts
join(crdt: GCounter): GCounter {
  return new GCounter(joinMaps(this.counts, crdt.counts, Math.max));
}
```

```ts
const a = GCounter.bottom.increment('a', 2);
const b = GCounter.bottom.increment('b', 3);
a.join(b).value(); // 5
```

#### PN-Counter

`src/pncounter.ts`: dos G-Counters, `positive` (incrementos) y `negative` (decrementos). Valor:
`positive - negative`. `decrement` es incrementar `negative`, así que el estado sigue creciendo y el join es el de
cada G-Counter.

El valor puede quedar negativo (test `stock >= 0`): dos réplicas venden la última unidad a la vez. Es el
invariante no I-confluent de `main`. Los counters de Cassandra son parecidos (una parte del counter por nodo).

#### Limitación: replica ids sin límite

El estado tiene una entrada por cada réplica que alguna vez escribió. Si cada cliente (browser, celular) es una
réplica, el estado crece para siempre. Y una entrada de una réplica retirada no se puede borrar sin coordinación:
si una réplica la borra y otra todavía la tiene, el join la vuelve a traer; si todas la borran, se pierden sus
incrementos.

Soluciones:

- Solo los nodos del servidor son réplicas (pocos ids, estables); los clientes le mandan incrementos a un nodo.
  Es lo que hace Cassandra.
- Garbage collection coordinado, o epochs: con consenso, se suman las entradas retiradas a un valor base y se
  empieza una epoch nueva.
- Handoff counters (Almeida y Baquero): los clientes le pasan su cuenta a un servidor con un protocolo de
  handoff, y después su entrada se puede descartar.

**Siguiente:** [`7-crdt-sets`](https://github.com/fiubaTA050/leaderless-replication/tree/7-crdt-sets)

import { it, expect } from 'vitest';
import fc from 'fast-check';
import { PNCounter } from '../src/pncounter.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Hasta 10 ids de réplica al azar, elegidos una vez por corrida: se repiten entre updates y estados
const replicaId = fc.constantFrom(...fc.sample(fc.string(), 10));

// Un update al azar: increment o decrement
const pncounterUpdate = fc.tuple(replicaId, fc.nat()).chain(([id, n]) =>
  fc.constantFrom(
    (crdt: PNCounter) => crdt.increment(id, n),
    (crdt: PNCounter) => crdt.decrement(id, n),
  ),
);

testCrdtLaws('PN-Counter', PNCounter, pncounterUpdate, (crdt, update) => update(crdt));

// Semántica
it('incrementos y decrementos concurrentes', () => {
  const a = PNCounter.bottom.increment('a', 5);
  const b = PNCounter.bottom.decrement('b', 2);
  return expect(a.join(b).value()).toBe(3);
});

it('el valor puede ser negativo: stock >= 0 no se puede garantizar sin coordinación', () => {
  const stock = PNCounter.bottom.increment('a', 1);
  const a = stock.decrement('a', 1);
  const b = stock.decrement('b', 1);
  return expect(a.join(b).value()).toBe(-1);
});

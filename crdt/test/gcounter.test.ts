import { it, expect } from 'vitest';
import fc from 'fast-check';
import { GCounter } from '../src/gcounter.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Hasta 10 ids de réplica al azar, elegidos una vez por corrida: se repiten entre updates y estados
const replicaId = fc.constantFrom(...fc.sample(fc.string(), 10));

testCrdtLaws('G-Counter', GCounter, fc.tuple(replicaId, fc.nat()), (crdt, [id, n]) => crdt.increment(id, n));

// Semántica
it('incrementos concurrentes en réplicas distintas se suman', () => {
  const a = GCounter.bottom.increment('a', 2);
  const b = GCounter.bottom.increment('b', 3);
  return expect(a.join(b).value()).toBe(5);
});

it('no se puede decrementar', () => expect(() => GCounter.bottom.increment('a', -1)).toThrow());

import { it, expect } from 'vitest';
import fc from 'fast-check';
import { RWSet } from '../src/rwset.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Hasta 100 elementos al azar, elegidos una vez por corrida
const element = fc.constantFrom(...fc.sample(fc.string(), 100));
// Hasta 10 ids de réplica al azar, elegidos una vez por corrida: se repiten entre updates y estados.
// Por convención, un id de réplica no tiene ":" (es el separador de los tags).
const replicaId = fc.constantFrom(...fc.sample(fc.string().filter((id) => !id.includes(':')), 10));

// Un update al azar: add o remove
const rwsetUpdate = fc.tuple(element, replicaId).chain(([e, id]) =>
  fc.constantFrom(
    (crdt: RWSet) => crdt.add(e, id),
    (crdt: RWSet) => crdt.remove(e, id),
  ),
);

testCrdtLaws('Remove-wins set', RWSet, rwsetUpdate, (crdt, update) => update(crdt));

// Semántica
it('add y remove concurrentes: gana remove', () => {
  const s = RWSet.bottom.add('x', 'a');
  const a = s.remove('x', 'a');
  const b = s.add('x', 'b');
  return expect(a.join(b).value().has('x')).toBe(false);
});

it('add después de remove (en orden causal) agrega', () => {
  const a = RWSet.bottom.add('x', 'a').remove('x', 'a');
  const b = RWSet.bottom.join(a).add('x', 'b');
  return expect(a.join(b).value().has('x')).toBe(true);
});

it('remove después de add (en orden causal) borra', () => {
  const a = RWSet.bottom.add('x', 'a');
  const b = RWSet.bottom.join(a).remove('x', 'b');
  return expect(a.join(b).value().has('x')).toBe(false);
});

it('remove de algo que esta réplica no vio gana contra un add concurrente', () => {
  const a = RWSet.bottom.remove('x', 'a');
  const b = RWSet.bottom.add('x', 'b');
  return expect(a.join(b).value()).toEqual(new Set());
});

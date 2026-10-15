import { it, expect } from 'vitest';
import fc from 'fast-check';
import { ORSet } from '../src/orset.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Hasta 100 elementos al azar, elegidos una vez por corrida
const element = fc.constantFrom(...fc.sample(fc.string(), 100));
// Hasta 10 ids de réplica al azar, elegidos una vez por corrida: se repiten entre updates y estados.
// Por convención, un id de réplica no tiene ":" (es el separador de los tags).
const replicaId = fc.constantFrom(...fc.sample(fc.string().filter((id) => !id.includes(':')), 10));

// Un update al azar: add o remove
const orsetUpdate = fc.tuple(element, replicaId).chain(([e, id]) =>
  fc.constantFrom(
    (crdt: ORSet) => crdt.add(e, id),
    (crdt: ORSet) => crdt.remove(e),
  ),
);

testCrdtLaws('OR-Set', ORSet, orsetUpdate, (crdt, update) => update(crdt));

// Semántica
it('tags determinísticos: los mismos updates en dos réplicas dan el mismo estado', () => {
  const a = ORSet.bottom.add('x', 'a').add('x', 'a');
  const b = ORSet.bottom.add('x', 'a').add('x', 'a');
  return expect(a.equals(b)).toBe(true);
});

it('add y remove concurrentes: gana add', () => {
  const s = ORSet.bottom.add('x', 'a');
  const a = s.remove('x');
  const b = s.add('x', 'b');
  return expect(a.join(b).value().has('x')).toBe(true);
});

it('remove solo borra los tags que observó', () => {
  const s = ORSet.bottom.add('x', 'a');
  const joined = s.remove('x').join(s.add('x', 'b'));
  // El add concurrente sobrevive, y un remove que ya lo observó lo borra
  return expect([joined.value().has('x'), joined.remove('x').value().has('x')]).toEqual([true, false]);
});

it('se puede volver a agregar después de borrar', () =>
  expect(ORSet.bottom.add('x', 'a').remove('x').add('x', 'a').value().has('x')).toBe(true));

it('remove después de add (en orden causal) borra', () => {
  const a = ORSet.bottom.add('x', 'a');
  const b = ORSet.bottom.join(a).remove('x');
  return expect(a.join(b).value()).toEqual(new Set());
});

it('una réplica que pierde su estado reusa un tag: su add nuevo queda borrado', () => {
  const a = ORSet.bottom.add('x', 'a');
  const b = ORSet.bottom.join(a).remove('x');
  const restarted = ORSet.bottom.add('x', 'a');
  return expect(restarted.join(b).value().has('x')).toBe(false);
});

import { it, expect } from 'vitest';
import fc from 'fast-check';
import { TwoPSet } from '../src/twopset.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Hasta 100 elementos al azar, elegidos una vez por corrida
const element = fc.constantFrom(...fc.sample(fc.string(), 100));

// Un update al azar: add o remove
const twopsetUpdate = element.chain((e) =>
  fc.constantFrom(
    (crdt: TwoPSet) => crdt.add(e),
    (crdt: TwoPSet) => crdt.remove(e),
  ),
);

testCrdtLaws('2P-Set', TwoPSet, twopsetUpdate, (crdt, update) => update(crdt));

// Semántica
it('add y remove concurrentes: gana remove', () => {
  const s = TwoPSet.bottom.add('x');
  const a = s.add('x');
  const b = s.remove('x');
  return expect(a.join(b).value().has('x')).toBe(false);
});

it('un elemento borrado no se puede volver a agregar', () =>
  expect(TwoPSet.bottom.add('x').remove('x').add('x').value().has('x')).toBe(false));

import { it, expect } from 'vitest';
import fc from 'fast-check';
import { GSet } from '../src/gset.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Hasta 100 elementos al azar, elegidos una vez por corrida
const element = fc.constantFrom(...fc.sample(fc.string(), 100));

testCrdtLaws('G-Set', GSet, element, (crdt, e) => crdt.add(e));

// Semántica
it('adds concurrentes: unión', () => {
  const a = GSet.bottom.add('x');
  const b = GSet.bottom.add('y');
  return expect(a.join(b).value()).toEqual(new Set(['x', 'y']));
});

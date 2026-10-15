import { it, expect } from 'vitest';
import fc from 'fast-check';
import { LWWRegister } from '../src/lwwregister.ts';
import { testCrdtLaws } from './commons/laws.ts';

testCrdtLaws('LWW-Register', LWWRegister, fc.tuple(fc.nat(), fc.nat()), (crdt, [v, t]) => crdt.set(v, t));

// Semántica
it('writes concurrentes: gana el timestamp mayor y el otro se pierde', () => {
  const a = LWWRegister.bottom.set('Ana', 1001);
  const b = LWWRegister.bottom.set('Beto', 1000);
  return expect(a.join(b).value()).toBe('Ana');
});

it('un write con el reloj atrasado se ignora, aunque sea posterior', () =>
  expect(LWWRegister.bottom.set('Ana', 61_000).set('Beto', 1000).value()).toBe('Ana'));

it('timestamps iguales: gana el de JSON mayor, sea del tipo que sea', () => {
  const a = LWWRegister.bottom.set({ nombre: 'Ana' }, 1000);
  const b = LWWRegister.bottom.set({ nombre: 'Beto' }, 1000);
  return expect(a.join(b).value()).toEqual({ nombre: 'Beto' });
});

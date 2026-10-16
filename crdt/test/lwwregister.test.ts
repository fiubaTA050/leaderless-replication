import { it, expect } from 'vitest';
import fc from 'fast-check';
import { LWWRegister } from '../src/lwwregister.ts';

// Epoch en segundos dentro de un minuto desde windowStart: pocos valores posibles, así que hay timestamps iguales y
// se prueba el desempate
const windowStart = 1792108800; // 2026-10-16 00:00:00 UTC
const timestampArb = fc.integer({ min: windowStart, max: windowStart + 60 });

const lwwregisterArbitrary = fc.array(fc.tuple(fc.nat(), timestampArb))
  .map((updates) => updates.reduce((crdt, [v, t]) => crdt.set(v, t), LWWRegister.bottom));

it('join es conmutativo', () => fc.assert(fc.property(lwwregisterArbitrary, lwwregisterArbitrary, (a, b) =>
  a.join(b).equals(b.join(a)))));

it('join es asociativo', () => fc.assert(fc.property(
  lwwregisterArbitrary,
  lwwregisterArbitrary,
  lwwregisterArbitrary,
  (a, b, c) => a.join(b).join(c).equals(a.join(b.join(c))),
)));

it('join es idempotente', () => fc.assert(fc.property(lwwregisterArbitrary, (a) =>
  a.join(a).equals(a))));

it('bottom es el neutro del join', () => fc.assert(fc.property(lwwregisterArbitrary, (a) =>
  LWWRegister.bottom.join(a).equals(a))));

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

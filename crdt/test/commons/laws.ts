import { it } from 'vitest';
import fc from 'fast-check';
import type { Crdt } from '../../src/crdt.ts';

// Estados de prueba: parámetros al azar, aplicados en orden desde bottom con apply
function crdtArbitrary<T, P>(type: { bottom: T }, params: fc.Arbitrary<P>, apply: (crdt: T, param: P) => T) {
  return fc.array(params).map((updates) => updates.reduce(apply, type.bottom));
}

// Leyes que cumple todo CRDT: join conmutativo, asociativo e idempotente, y bottom neutro del join.
// type es la clase del CRDT (tiene el static bottom). Los estados de prueba salen de aplicar con apply una lista de
// params al azar desde bottom.
export function testCrdtLaws<T extends Crdt<T, unknown>, P>(
  name: string,
  type: { bottom: T },
  params: fc.Arbitrary<P>,
  apply: (crdt: T, param: P) => T,
) {
  const arb = crdtArbitrary(type, params, apply);
  return [
    // a ⊔ b = b ⊔ a
    it(`${name}: join es conmutativo`, () => fc.assert(fc.property(arb, arb, (a, b) =>
      a.join(b).equals(b.join(a))))),

    // (a ⊔ b) ⊔ c = a ⊔ (b ⊔ c)
    it(`${name}: join es asociativo`, () => fc.assert(fc.property(arb, arb, arb, (a, b, c) =>
      a.join(b).join(c).equals(a.join(b.join(c)))))),

    // a ⊔ a = a
    it(`${name}: join es idempotente`, () => fc.assert(fc.property(arb, (a) =>
      a.join(a).equals(a)))),

    // ⊥ ⊔ a = a
    it(`${name}: bottom es el neutro del join`, () => fc.assert(fc.property(arb, (a) =>
      type.bottom.join(a).equals(a)))),
  ];
}

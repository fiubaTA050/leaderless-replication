import { it, expect } from 'vitest';
import fc from 'fast-check';
import { LWWRegister } from '../src/lwwregister.ts';
import { testCrdtLaws } from './commons/laws.ts';

// Epoch en segundos dentro de un minuto desde windowStart: pocos valores posibles, así que hay timestamps iguales y
// se prueba el desempate
const windowStart = 1792108800; // 2026-10-16 00:00:00 UTC
const timestampArb = fc.integer({ min: windowStart, max: windowStart + 60 });

testCrdtLaws('LWW-Register', LWWRegister, fc.tuple(fc.nat(), timestampArb), (crdt, [v, t]) => crdt.set(v, t));

// Semántica
it('writes concurrentes: gana el timestamp mayor y el otro se pierde', () => {
  const a = LWWRegister.bottom.set('Ana', 1001);
  const b = LWWRegister.bottom.set('Beto', 1000);
  return expect(a.join(b).value()).toBe('Ana');
});

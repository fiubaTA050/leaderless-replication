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

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { registerPin, type DirectoryRepository, type PinRecord } from './directory';

// Feature: pinme-burnable-pin-messenger, Property 4: Registration validity and collision safety
// **Validates: Requirements 2.3, 2.4, 2.7, 13.14**

class FakeRepo implements DirectoryRepository {
  pins = new Map<string, PinRecord>();
  burned = new Set<string>();
  async getPin(pin: string) {
    return this.pins.get(pin) ?? null;
  }
  async isBurned(pin: string) {
    return this.burned.has(pin);
  }
  async insertPin(record: PinRecord) {
    if (this.pins.has(record.pin)) return false;
    this.pins.set(record.pin, record);
    return true;
  }
  snapshot() {
    return JSON.stringify([[...this.pins.entries()].sort(), [...this.burned].sort()]);
  }
}

const HEX = '0123456789ABCDEF'.split('');
const pinArb = fc.array(fc.constantFrom(...HEX), { minLength: 8, maxLength: 8 }).map((a) => a.join(''));
// Small PIN pool so collisions are frequent.
const poolPin = fc.constantFrom('00000000', '11111111', 'DEADBEEF', 'CAFEBABE');
const keyArb = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((b) => Buffer.from(b).toString('base64'));
const badKeyArb = fc.oneof(
  fc.uint8Array({ minLength: 0, maxLength: 31 }).map((b) => Buffer.from(b).toString('base64')),
  fc.uint8Array({ minLength: 33, maxLength: 48 }).map((b) => Buffer.from(b).toString('base64')),
  fc.constant('not base64!!'),
);
const nameArb = fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.trim().length >= 1 && s.trim().length <= 32);
const badNameArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.string({ minLength: 33, maxLength: 60 }).map((s) => 'x'.repeat(33) + s),
);

const validBody = (pin: fc.Arbitrary<string>) =>
  fc.record({
    pin,
    boxPublicKey: keyArb,
    signPublicKey: keyArb,
    displayName: nameArb,
    status: fc.constantFrom('available', 'busy'),
    personalMessage: fc.string({ maxLength: 80 }),
  });

const invalidBody = fc
  .tuple(
    validBody(pinArb),
    fc.oneof(
      fc.record({ pin: fc.constantFrom('abc', 'GGGGGGGG', '1234567', '123456789', 'deadbeef', '') }),
      fc.record({ boxPublicKey: badKeyArb }),
      fc.record({ signPublicKey: badKeyArb }),
      fc.record({ displayName: badNameArb }),
      fc.record({ personalMessage: fc.string({ minLength: 81, maxLength: 120 }) }),
      fc.record({ status: fc.constant('away') }),
      fc.record({ extra: fc.constant(1) }),
    ),
  )
  .map(([ok, bad]) => ({ ...ok, ...bad }));

describe('Property 4: Registration validity and collision safety', () => {
  it('succeeds iff well formed and PIN in neither pins nor burned_pins; failures leave Directory unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(validBody(poolPin), validBody(pinArb), invalidBody),
        fc.array(fc.tuple(poolPin, fc.record({ box: keyArb })), { maxLength: 3 }),
        fc.array(poolPin, { maxLength: 3 }),
        async (body, existing, burned) => {
          const repo = new FakeRepo();
          for (const b of burned) repo.burned.add(b);
          for (const [p, { box }] of existing) {
            if (repo.burned.has(p)) continue;
            repo.pins.set(p, {
              pin: p,
              boxPublicKey: box,
              signPublicKey: box,
              displayName: 'x',
              status: 'available',
              personalMessage: '',
            });
          }
          const before = repo.snapshot();
          const wellFormed = !('extra' in body) && isWellFormed(body);
          const taken = repo.pins.has((body as { pin: string }).pin) || repo.burned.has((body as { pin: string }).pin);

          const res = await registerPin(repo, body);

          if (wellFormed && !taken) {
            expect(res.ok).toBe(true);
            expect(repo.pins.has((body as { pin: string }).pin)).toBe(true);
            expect(repo.burned.size).toBe(new Set(burned).size);
          } else {
            expect(res.ok).toBe(false);
            expect(repo.snapshot()).toBe(before);
            if (wellFormed && taken && !res.ok) expect(res.code).toBe('collision');
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('rejects bodies containing private-key fields without writing', async () => {
    const repo = new FakeRepo();
    const res = await registerPin(repo, {
      pin: 'DEADBEEF',
      boxPublicKey: Buffer.alloc(32).toString('base64'),
      signPublicKey: Buffer.alloc(32).toString('base64'),
      displayName: 'a',
      boxPrivateKey: 'zzz',
    });
    expect(res.ok).toBe(false);
    expect(repo.pins.size).toBe(0);
  });
});

/** Independent oracle for well-formedness. */
function isWellFormed(b: Record<string, unknown>): boolean {
  const key = (k: unknown) =>
    typeof k === 'string' && /^[A-Za-z0-9+/_-]+={0,2}$/.test(k) && Buffer.from(k, 'base64').length === 32;
  const name = typeof b.displayName === 'string' ? b.displayName.trim() : '';
  return (
    typeof b.pin === 'string' &&
    /^[0-9A-F]{8}$/.test(b.pin) &&
    key(b.boxPublicKey) &&
    key(b.signPublicKey) &&
    name.length >= 1 &&
    name.length <= 32 &&
    (b.status === 'available' || b.status === 'busy') &&
    typeof b.personalMessage === 'string' &&
    b.personalMessage.length <= 80
  );
}

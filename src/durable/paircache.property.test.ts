import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PairCache, PAIR_CACHE_TTL_MS } from './paircache';

// Feature: pinme-burnable-pin-messenger, Property 21: Pair removal takes effect
// **Validates: Requirements 16.2, 16.5, 16.6**

const PINS = ['a', 'b', 'c'];
const pin = fc.constantFrom(...PINS);

type Op =
  | { t: 'add'; pin: string }
  | { t: 'remove'; pin: string }
  | { t: 'relay'; pin: string }
  | { t: 'down'; down: boolean }
  | { t: 'tick'; ms: number };

const op: fc.Arbitrary<Op> = fc.oneof(
  pin.map((p) => ({ t: 'add', pin: p }) as Op),
  pin.map((p) => ({ t: 'remove', pin: p }) as Op),
  pin.map((p) => ({ t: 'relay', pin: p }) as Op),
  fc.boolean().map((down) => ({ t: 'down', down }) as Op),
  fc.integer({ min: 0, max: PAIR_CACHE_TTL_MS * 2 }).map((ms) => ({ t: 'tick', ms }) as Op),
);

describe('Property 21: Pair removal takes effect', () => {
  it('never relays for a removed pair, and fails closed when Directory is down and uncached', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(op, { maxLength: 60 }), async (ops) => {
        const cache = new PairCache();
        const directory = new Set<string>();
        const cachedPins = new Set<string>();
        let down = false;
        let now = 1000;
        const fetcher = async (p: string) => {
          if (down) throw new Error('directory unreachable');
          return directory.has(p);
        };

        for (const o of ops) {
          switch (o.t) {
            case 'add':
              directory.add(o.pin);
              cache.invalidate();
              cachedPins.clear();
              break;
            case 'remove':
              directory.delete(o.pin);
              cache.invalidate();
              cachedPins.clear();
              break;
            case 'down':
              down = o.down;
              break;
            case 'tick':
              now += o.ms;
              break;
            case 'relay': {
              const wasCached = cachedPins.has(o.pin);
              const v = await cache.check(o.pin, now, fetcher);
              if (!directory.has(o.pin) && v.ok) {
                throw new Error(`relayed for non-contact ${o.pin}`);
              }
              if (down && !wasCached) {
                expect(v).toEqual({ ok: false, error: 'verification_unavailable' });
              }
              if (!down) cachedPins.add(o.pin);
              break;
            }
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('a cached pair is not relayed after removal (cache invalidated)', async () => {
    const cache = new PairCache();
    let accepted = true;
    const fetcher = async () => accepted;
    expect(await cache.check('a', 0, fetcher)).toEqual({ ok: true });
    accepted = false;
    cache.invalidate();
    expect(await cache.check('a', 1, fetcher)).toEqual({ ok: false, error: 'not_a_contact' });
  });
});

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { beginConnection } from './handshake';
import { base64ToBytes } from '../shared/base64';
import type { DirectoryClient } from './directoryClient';

// Feature: pinme-burnable-pin-messenger, Property 12: Challenge uniqueness and size
// **Validates: Requirements 6.3**

const directory: DirectoryClient = {
  async lookupPin() {
    return { state: 'active', signPublicKey: '', boxPublicKey: '' };
  },
  async isContactPair() {
    return true;
  },
};

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

describe('Property 12: Challenge uniqueness and size', () => {
  it('every challenge is exactly 32 bytes and no two are equal', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 2, max: 200 }), async (count) => {
        const seen = new Set<string>();
        for (let i = 0; i < count; i++) {
          const out = await beginConnection('pin', directory, randomBytes, 0);
          expect(out.kind).toBe('challenge');
          if (out.kind !== 'challenge') return;
          expect(base64ToBytes(out.attachment.challenge).length).toBe(32);
          seen.add(out.attachment.challenge);
        }
        expect(seen.size).toBe(count);
      }),
      { numRuns: 50 },
    );
  });
});

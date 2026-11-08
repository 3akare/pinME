import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { guardPrivateKeys } from "./guard";

// Feature: pinme-burnable-pin-messenger, Property 35: Private key fields rejected
// **Validates: Requirements 17.6, 17.3**

const safeKey = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((k) => !/priv|secret/i.test(k));
const forbiddenKey = fc
  .tuple(
    fc.string({ maxLength: 4 }),
    fc.constantFrom("priv", "PRIV", "Private", "secret", "SECRET", "Secret"),
    fc.string({ maxLength: 4 }),
  )
  .map(([a, b, c]) => `${a}${b}${c}`);
const leaf = fc.oneof(fc.string({ maxLength: 8 }), fc.integer(), fc.boolean(), fc.constant(null));

const cleanJson = fc.letrec((tie) => ({
  node: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    leaf,
    fc.array(tie("node"), { maxLength: 3 }),
    fc.dictionary(safeKey, tie("node"), { maxKeys: 3 }),
  ),
})).node;

/** Embeds a forbidden key at a random nesting path (objects and arrays). */
const taintedBody = fc
  .tuple(
    forbiddenKey,
    fc.string({ minLength: 6, maxLength: 12 }),
    fc.array(fc.tuple(safeKey, fc.boolean()), { maxLength: 4 }),
    cleanJson,
  )
  .map(([bad, value, path, sibling]) => {
    let node: unknown = { [bad]: value, other: sibling };
    for (const [k, wrapInArray] of path) node = { [k]: wrapInArray ? [sibling, node] : node };
    return { body: node, bad, value };
  });

describe("Property 35: guardPrivateKeys", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects bodies with a priv/secret key at any depth and logs no payload", () => {
    fc.assert(
      fc.property(taintedBody, ({ body, bad, value }) => {
        const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const res = guardPrivateKeys(body);
        const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
        spy.mockRestore();
        expect(res).toEqual({ ok: false, code: "private_key_not_accepted" });
        expect(logged).not.toContain(JSON.stringify(bad));
        expect(logged).not.toContain(value);
      }),
      { numRuns: 100 },
    );
  });

  it("accepts bodies without such keys", () => {
    fc.assert(
      fc.property(cleanJson, (body) => {
        expect(guardPrivateKeys(body)).toEqual({ ok: true });
      }),
      { numRuns: 100 },
    );
  });
});

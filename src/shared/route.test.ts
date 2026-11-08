import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { routeFor } from "./route";

const hexPin = fc.stringMatching(/^[0-9A-F]{8}$/);

describe("Property 11: WebSocket routing", () => {
  // **Validates: Requirements 6.2, 18.3, 18.4**
  it("routes /ws/<valid pin> to that mailbox", () => {
    fc.assert(
      fc.property(hexPin, (pin) => {
        expect(routeFor(`/ws/${pin}`)).toEqual({ kind: "mailbox", pin });
      }),
    );
  });

  it("routes every other path to the app (or echo for /ws-echo)", () => {
    fc.assert(
      fc.property(fc.string(), (path) => {
        const isMailbox = /^\/ws\/[0-9A-F]{8}$/.test(path);
        const r = routeFor(path);
        if (isMailbox) expect(r.kind).toBe("mailbox");
        else if (path === "/ws-echo") expect(r.kind).toBe("echo");
        else expect(r).toEqual({ kind: "app" });
      }),
      { numRuns: 500 },
    );
  });

  it("routes near-miss mailbox paths to the app", () => {
    fc.assert(
      fc.property(
        hexPin,
        fc.constantFrom("", "/", "x", "/extra"),
        (pin, suffix) => {
          expect(routeFor(`/ws/${pin}${suffix}`).kind).toBe(
            suffix === "" ? "mailbox" : "app",
          );
          expect(routeFor(`/ws/${pin.slice(1)}`).kind).toBe("app");
          expect(routeFor(`/ws/${pin.toLowerCase()}`).kind).toBe(
            pin === pin.toLowerCase() ? "mailbox" : "app",
          );
        },
      ),
    );
  });
});

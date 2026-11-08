import { describe, expect, it, vi } from "vitest";
import { bytesToBase64 } from "./base64";
import { ClientMsg, MESSAGE_TYPES, parseFrame, ServerMsg } from "./protocol";
import { safeLog } from "./safeLog";

const id = "123e4567-e89b-42d3-a456-426614174000";
const env = (ct = 10) => ({
  to: "ABCDEF01",
  messageId: id,
  nonce: bytesToBase64(new Uint8Array(24)),
  ciphertext: bytesToBase64(new Uint8Array(ct)),
});

describe("parseFrame", () => {
  it("round-trips a message", () => {
    const m = { type: "message", envelope: env() };
    const r = parseFrame(JSON.stringify(m), "client");
    expect(r).toEqual({ ok: true, value: m });
  });
  it("accepts 8192 and rejects 8193 ciphertext bytes", () => {
    expect(parseFrame(JSON.stringify({ type: "message", envelope: env(8192) }), "client").ok).toBe(true);
    const r = parseFrame(JSON.stringify({ type: "message", envelope: env(8193) }), "client");
    expect(r).toEqual({ ok: false, reason: "validation_failed", type: "message", field: "envelope.ciphertext" });
  });
  it("rejects bad nonce length", () => {
    const e = { ...env(), nonce: bytesToBase64(new Uint8Array(23)) };
    const r = parseFrame(JSON.stringify({ type: "message", envelope: e }), "client");
    expect(r).toMatchObject({ ok: false, field: "envelope.nonce" });
  });
  it("broadcast allows 100 and rejects 101", () => {
    const mk = (n: number) => JSON.stringify({ type: "broadcast", envelopes: Array.from({ length: n }, () => env()) });
    expect(parseFrame(mk(100), "client").ok).toBe(true);
    expect(parseFrame(mk(101), "client")).toMatchObject({ ok: false, type: "broadcast", field: "envelopes" });
  });
  it("handles invalid JSON and unknown type without content", () => {
    expect(parseFrame("{nope", "server")).toEqual({ ok: false, reason: "invalid_json" });
    expect(parseFrame('{"type":"secret","x":1}', "server")).toEqual({ ok: false, reason: "unknown_type" });
  });
  it("has exactly eleven types", () => {
    expect(MESSAGE_TYPES).toHaveLength(11);
    const names = new Set([
      ...ServerMsg.options.map((o) => o.shape.type.value),
      ...ClientMsg.options.map((o) => o.shape.type.value),
    ]);
    expect([...names].sort()).toEqual([...MESSAGE_TYPES].sort());
  });
  it("accepts not_delivered error", () => {
    expect(parseFrame('{"type":"error","code":"not_delivered"}', "server").ok).toBe(true);
  });
});

describe("safeLog", () => {
  it("logs only sanitized fields", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    safeLog("bad frame", { type: "message", field: "a b secret", code: "validation_failed" });
    expect(JSON.parse(spy.mock.calls[0]![0] as string)).toEqual({
      event: "redacted",
      type: "message",
      field: "redacted",
      code: "validation_failed",
    });
    spy.mockRestore();
  });
});

import { describe, expect, it, vi } from "vitest";
import type { ContactRecord } from "../../storage";
import { createPresenceHandler } from "./presence";

const OWN = "AAAA1111";
const FRIEND = "BBBB2222";
function contact(): ContactRecord {
  return {
    ownPin: OWN,
    contactPin: FRIEND,
    displayName: "Friend",
    boxPk: new Uint8Array(32),
    signPk: new Uint8Array(32),
    status: "active",
    personalMessage: "old",
    presence: "available",
    unavailable: false,
  };
}
function setup(existing: ContactRecord | undefined) {
   
  const put = vi.fn(async (_r: ContactRecord) => {});
  const upsertContact = vi.fn();
  const handler = createPresenceHandler(OWN, {
    repos: {
      contactRepo: { get: async () => existing, listForPin: async () => [], put, delete: async () => {} },
    },
    store: { upsertContact },
  });
  return { handler, put, upsertContact };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("createPresenceHandler", () => {
  it("updates presence and personal message in storage and store", async () => {
    const s = setup(contact());
    s.handler({ type: "inviteNotice", kind: "presence", from: FRIEND, status: "busy", personalMessage: "away" });
    await flush();
    const saved = s.put.mock.calls[0]![0];
    expect(saved.presence).toBe("busy");
    expect(saved.personalMessage).toBe("away");
    expect(s.upsertContact).toHaveBeenCalledWith(saved);
  });

  it("ignores presence from a non-contact", async () => {
    const s = setup(undefined);
    s.handler({ type: "inviteNotice", kind: "presence", from: FRIEND, status: "busy", personalMessage: "x" });
    await flush();
    expect(s.put).not.toHaveBeenCalled();
    expect(s.upsertContact).not.toHaveBeenCalled();
  });

  it("ignores non-presence notices", async () => {
    const s = setup(contact());
    s.handler({ type: "inviteNotice", kind: "accepted", from: FRIEND });
    await flush();
    expect(s.put).not.toHaveBeenCalled();
  });
});

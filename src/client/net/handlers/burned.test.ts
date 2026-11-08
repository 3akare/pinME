import { describe, expect, it, vi } from "vitest";
import { createDispatcher } from "../dispatch";
import type { ContactRecord } from "../../storage";
import { registerBurnedHandlers } from "./burned";
const OWN = "AAAA1111";
const FRIEND = "BBBB2222";
const contact = (): ContactRecord => ({
  ownPin: OWN, contactPin: FRIEND, displayName: "F", boxPk: new Uint8Array(32), signPk: new Uint8Array(32),
  status: "active", personalMessage: "", unavailable: false,
});
const flush = () => new Promise((r) => setTimeout(r, 0));
describe("registerBurnedHandlers", () => {
  it("marks the contact unavailable in storage and store", async () => {
    const put = vi.fn(async () => {});
    const upsertContact = vi.fn();
    const d = createDispatcher();
    registerBurnedHandlers(d, {
      ownPin: OWN,
      repos: { contactRepo: { get: async () => contact(), listForPin: async () => [], put, delete: async () => {} } },
      store: { upsertContact },
    });
    d.dispatch(JSON.stringify({ type: "contactBurned", pin: FRIEND }));
    await flush();
    expect(put).toHaveBeenCalledWith(expect.objectContaining({ contactPin: FRIEND, unavailable: true }));
    expect(upsertContact).toHaveBeenCalledWith(expect.objectContaining({ unavailable: true }));
  });
  it("ignores unknown contacts", async () => {
    const put = vi.fn(async () => {});
    const upsertContact = vi.fn();
    const d = createDispatcher();
    registerBurnedHandlers(d, {
      ownPin: OWN,
      repos: { contactRepo: { get: async () => undefined, listForPin: async () => [], put, delete: async () => {} } },
      store: { upsertContact },
    });
    d.dispatch(JSON.stringify({ type: "contactBurned", pin: FRIEND }));
    await flush();
    expect(put).not.toHaveBeenCalled();
    expect(upsertContact).not.toHaveBeenCalled();
  });
});

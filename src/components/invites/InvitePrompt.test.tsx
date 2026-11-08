// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useContactsStore } from "../../client/state/contacts";
import { usePinsStore } from "../../client/state/pins";
import type { InviteRecord, PinRecord } from "../../client/storage";
import { InvitePrompt } from "./InvitePrompt";

const respond = vi.fn();
vi.mock("./useInviteResponder", () => ({ useInviteResponder: () => respond }));

const pin = (p: string, label: string): PinRecord =>
  ({ pin: p, label, status: "active", createdAt: 0, personalMessage: "" }) as unknown as PinRecord;
const older: InviteRecord = { inviteId: "i1", ownPin: "AAAAAAAA", fromPin: "BBBBBBBB", fromDisplayName: "Bob", createdAt: 1 };
const newer: InviteRecord = { inviteId: "i2", ownPin: "CCCCCCCC", fromPin: "DDDDDDDD", createdAt: 2 };

beforeEach(() => {
  respond.mockReset();
  usePinsStore.getState().setPins([pin("AAAAAAAA", "Main"), pin("CCCCCCCC", "Market")]);
  useContactsStore.getState().setAll([], [newer, older]);
});
afterEach(cleanup);

describe("InvitePrompt", () => {
  it("asks about the oldest invite first, naming the sender and the receiving PIN", () => {
    render(<InvitePrompt />);
    expect(screen.getByRole("dialog").textContent).toContain("Bob wants to chat");
    expect(screen.getByRole("dialog").textContent).toContain("BBBBBBBB");
    expect(screen.getByRole("dialog").textContent).toContain("Main");
  });

  it("accepts for the PIN the invite was sent to", async () => {
    respond.mockImplementation(async (invite: InviteRecord) => {
      useContactsStore.getState().removeInvite(invite.inviteId);
      return { ok: true };
    });
    render(<InvitePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(respond).toHaveBeenCalledWith(older, true));
    // The next invite (to the other PIN, no known name) follows.
    await waitFor(() => expect(screen.getByRole("dialog").textContent).toContain("DDDDDDDD"));
  });

  it("keeps the invite and shows an error when the response fails", async () => {
    respond.mockResolvedValue({ ok: false, code: "not_found" });
    render(<InvitePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("This invite is no longer available."));
    expect(screen.getByRole("dialog").textContent).toContain("Bob");
  });

  it("Later and Escape set invites aside without answering them", () => {
    render(<InvitePrompt />);
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByRole("dialog").textContent).toContain("DDDDDDDD");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(respond).not.toHaveBeenCalled();
    expect(useContactsStore.getState().pendingInvites).toHaveLength(2);
  });

  it("appears when an invite arrives", () => {
    useContactsStore.getState().setAll([], []);
    render(<InvitePrompt />);
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useContactsStore.getState().addInvite(older));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});

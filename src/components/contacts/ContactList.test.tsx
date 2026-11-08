// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContactRecord, InviteRecord } from "../../client/storage";
import { addErrorMessage, PIN_FORMAT_MESSAGE } from "../../client/invites/messages";
import { ContactRow } from "./ContactRow";
import { InviteRow } from "../invites/InviteRow";

afterEach(cleanup);

const contact = (over: Partial<ContactRecord> = {}): ContactRecord => ({
  ownPin: "AAAAAAAA",
  contactPin: "BBBBBBBB",
  displayName: "Alice",
  boxPk: new Uint8Array(32),
  signPk: new Uint8Array(32),
  status: "active",
  personalMessage: "Hello there",
  unavailable: false,
  ...over,
});
const invite: InviteRecord = { inviteId: "i1", ownPin: "AAAAAAAA", fromPin: "BBBBBBBB", createdAt: 1 };

describe("ContactRow", () => {
  it("renders rounded row with picture/placeholder, name, status and message", () => {
    const { container } = render(<ContactRow contact={contact({ presence: "available" })} onOpen={() => {}} />);
    const row = container.querySelector("button")!;
    expect(row.className).toContain("rounded-2xl");
    expect(screen.getByTestId("avatar-placeholder").textContent).toBe("A");
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Available" })).toBeTruthy();
    expect(screen.getByTestId("personal-message").textContent).toBe("Hello there");
  });

  it("shows the picture instead of the placeholder when one exists", () => {
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const { container } = render(
      <ContactRow contact={contact({ picture: new Blob(["x"], { type: "image/png" }) })} onOpen={() => {}} />,
    );
    expect(container.querySelector("img")).toBeTruthy();
    expect(screen.queryByTestId("avatar-placeholder")).toBeNull();
  });

  it("truncates name and personal message to a single line with ellipsis", () => {
    const { container } = render(<ContactRow contact={contact()} onOpen={() => {}} />);
    expect(screen.getByText("Alice").className).toContain("truncate");
    const msg = screen.getByTestId("personal-message");
    expect(msg.className).toContain("truncate");
    expect(msg.className).toContain("whitespace-nowrap");
    expect(container.querySelector(".min-w-0")).toBeTruthy();
  });

  it("status dot differs between Available and Busy", () => {
    const a = render(<ContactRow contact={contact({ presence: "available" })} onOpen={() => {}} />);
    const availDot = a.container.querySelector("[data-status]")!;
    const availClass = availDot.className;
    a.unmount();
    const b = render(<ContactRow contact={contact({ presence: "busy" })} onOpen={() => {}} />);
    const busyDot = b.container.querySelector("[data-status]")!;
    expect(availDot.getAttribute("data-status")).toBe("available");
    expect(busyDot.getAttribute("data-status")).toBe("busy");
    expect(busyDot.getAttribute("aria-label")).toBe("Busy");
    expect(busyDot.className).not.toBe(availClass);
  });

  it("never claims Available for an unreported or unavailable contact", () => {
    const unknown = render(<ContactRow contact={contact()} onOpen={() => {}} />);
    expect(screen.getByRole("img", { name: "Status unknown" })).toBeTruthy();
    unknown.unmount();
    render(<ContactRow contact={contact({ presence: "available", unavailable: true })} onOpen={() => {}} />);
    expect(screen.getByRole("img", { name: "Unavailable" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Available" })).toBeNull();
  });

  it("calls onOpen with the contact PIN", () => {
    const onOpen = vi.fn();
    render(<ContactRow contact={contact()} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("BBBBBBBB");
  });
});

describe("InviteRow", () => {
  it("accept success calls onRespond(id, true) and shows no error", async () => {
    const onRespond = vi.fn().mockResolvedValue({ ok: true });
    render(<ul><InviteRow invite={invite} onRespond={onRespond} /></ul>);
    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(invite, true));
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("decline success calls onRespond(id, false)", async () => {
    const onRespond = vi.fn().mockResolvedValue({ ok: true });
    render(<ul><InviteRow invite={invite} onRespond={onRespond} /></ul>);
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() => expect(onRespond).toHaveBeenCalledWith(invite, false));
  });

  it("shows an error on failure result and on thrown errors", async () => {
    const onRespond = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, code: "pin_burned" })
      .mockRejectedValueOnce(new Error("boom"));
    render(<ul><InviteRow invite={invite} onRespond={onRespond} /></ul>);
    fireEvent.click(screen.getByText("Accept"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("That PIN has been burned."));
    fireEvent.click(screen.getByText("Decline"));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Could not complete that. Please try again."),
    );
  });
});

describe("add-contact error mapping", () => {
  it("maps each code to a message", () => {
    expect(addErrorMessage("validation_failed")).toBe(PIN_FORMAT_MESSAGE);
    expect(addErrorMessage("not_found")).toContain("No PIN found");
    expect(addErrorMessage("pin_burned")).toContain("burned");
    expect(addErrorMessage("self_invite")).toContain("own PIN");
    expect(addErrorMessage("duplicate")).toContain("pending invite or contact");
    expect(addErrorMessage("rate_limited", 42)).toContain("42 seconds");
    expect(addErrorMessage("rate_limited")).toContain("later");
    expect(addErrorMessage("whatever")).toContain("Could not send");
  });
});

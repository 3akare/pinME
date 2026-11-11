// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_PLAINTEXT_CHARS } from "../../shared/limits";
import { MessageBubble } from "./MessageBubble";
import { MessageInput } from "./MessageInput";

afterEach(cleanup);

describe("MessageBubble", () => {
  it("aligns sent bubbles right and received bubbles left", () => {
    const out = render(<MessageBubble direction="out" text="hi" marker="D" />);
    expect(screen.getByTestId("message-bubble").className).toContain("justify-end");
    out.unmount();
    render(<MessageBubble direction="in" text="yo" />);
    expect(screen.getByTestId("message-bubble").className).toContain("justify-start");
  });

  it("shows a Delivery_Marker only on sent bubbles (clock/D/R)", () => {
    const { container, rerender } = render(<MessageBubble direction="out" text="a" marker="clock" />);
    expect(container.querySelector('[data-marker="clock"]')).toBeTruthy();
    rerender(<MessageBubble direction="out" text="a" marker="D" />);
    expect(container.querySelector('[data-marker="D"]')?.textContent).toBe("D");
    rerender(<MessageBubble direction="out" text="a" marker="R" />);
    expect(container.querySelector('[data-marker="R"]')?.textContent).toBe("R");
    rerender(<MessageBubble direction="in" text="a" marker="R" />);
    expect(container.querySelector("[data-marker]")).toBeNull();
  });

  it("defaults a sent bubble without marker to the clock", () => {
    const { container } = render(<MessageBubble direction="out" text="a" />);
    expect(container.querySelector('[data-marker="clock"]')).toBeTruthy();
  });
});

describe("MessageInput", () => {
  const sendBtn = () => screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
  const box = () => screen.getByLabelText("Message") as HTMLTextAreaElement;

  it("disables send when empty and enables it for 1 character", () => {
    render(<MessageInput onSend={() => true} connected />);
    expect(sendBtn().disabled).toBe(true);
    fireEvent.change(box(), { target: { value: "a" } });
    expect(sendBtn().disabled).toBe(false);
  });

  it("limits input to 4096 characters and allows exactly 4096", () => {
    render(<MessageInput onSend={() => true} connected />);
    expect(box().maxLength).toBe(MAX_PLAINTEXT_CHARS);
    fireEvent.change(box(), { target: { value: "x".repeat(MAX_PLAINTEXT_CHARS) } });
    expect(sendBtn().disabled).toBe(false);
    expect(screen.getByRole("status").textContent).toContain(`${MAX_PLAINTEXT_CHARS}/${MAX_PLAINTEXT_CHARS}`);
  });

  it("does not send an over-limit message", () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<MessageInput onSend={onSend} connected />);
    fireEvent.change(box(), { target: { value: "x".repeat(MAX_PLAINTEXT_CHARS + 1) } });
    expect(sendBtn().disabled).toBe(true);
    fireEvent.submit(box().closest("form")!);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends text and clears the field on success", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<MessageInput onSend={onSend} connected />);
    fireEvent.change(box(), { target: { value: "hello" } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("hello"));
    await waitFor(() => expect(box().value).toBe(""));
  });

  it("still accepts a message while offline (it is queued) and says so", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<MessageInput onSend={onSend} connected={false} />);
    expect(screen.getByRole("status").textContent).toContain("Offline");
    fireEvent.change(box(), { target: { value: "hello" } });
    expect(sendBtn().disabled).toBe(false);
    fireEvent.submit(box().closest("form")!);
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("hello"));
  });

  it("sends on Enter and keeps Shift+Enter for a new line", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<MessageInput onSend={onSend} connected />);
    fireEvent.change(box(), { target: { value: "line" } });
    fireEvent.keyDown(box(), { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("line"));
  });

  it("clears the field at once and restores it if sending fails", async () => {
    let resolve!: (ok: boolean) => void;
    const onSend = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    render(<MessageInput onSend={onSend} connected />);
    fireEvent.change(box(), { target: { value: "hello" } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(box().value).toBe(""));
    resolve(false);
    await waitFor(() => expect(box().value).toBe("hello"));
    expect(screen.getByRole("status").textContent).toContain("could not be sent");
  });

  it("on a touch screen, Enter adds a line and only the button sends", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      matches: q === "(pointer: coarse)",
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const onSend = vi.fn().mockResolvedValue(true);
      render(<MessageInput onSend={onSend} connected />);
      expect(box().getAttribute("enterkeyhint")).toBe("enter");
      fireEvent.change(box(), { target: { value: "line" } });
      fireEvent.keyDown(box(), { key: "Enter" });
      expect(onSend).not.toHaveBeenCalled();
      fireEvent.click(sendBtn());
      await waitFor(() => expect(onSend).toHaveBeenCalledWith("line"));
    } finally {
      window.matchMedia = original;
    }
  });

  it("keeps a draft per conversation and drops it once sent", async () => {
    sessionStorage.clear();
    const onSend = vi.fn().mockResolvedValue(true);
    const first = render(<MessageInput onSend={onSend} connected draftKey="A:B" />);
    fireEvent.change(box(), { target: { value: "half a thought" } });
    first.unmount();
    expect(sessionStorage.getItem("pinme:draft:A:B")).toBe("half a thought");
    render(<MessageInput onSend={onSend} connected draftKey="A:B" />);
    expect(box().value).toBe("half a thought");
    fireEvent.click(sendBtn());
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("half a thought"));
    expect(sessionStorage.getItem("pinme:draft:A:B")).toBeNull();
  });

  it("does not hold space for an empty hint", () => {
    render(<MessageInput onSend={() => true} connected />);
    expect(screen.getByRole("status").className).toContain("visually-hidden");
  });
});

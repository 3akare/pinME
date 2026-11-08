// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TypingIndicator } from "./TypingIndicator";

afterEach(cleanup);

it("shows the contact name while visible and nothing when hidden", () => {
  const { rerender } = render(<TypingIndicator name="Alice" visible />);
  expect(screen.getByText("Alice is writing a message...")).toBeTruthy();
  rerender(<TypingIndicator name="Alice" visible={false} />);
  expect(screen.queryByText(/writing a message/)).toBeNull();
});

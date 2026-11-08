import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { personalMessageError, saveErrorMessage, StatusEditor } from "./StatusEditor";

describe("StatusEditor", () => {
  it("validates personal message length 0-80", () => {
    expect(personalMessageError("")).toBeNull();
    expect(personalMessageError("x".repeat(80))).toBeNull();
    expect(personalMessageError("x".repeat(81))).not.toBeNull();
  });

  it("renders Available/Busy options with the saved values", () => {
    const html = renderToStaticMarkup(
      <StatusEditor
        initial={{ status: "busy", personalMessage: "hello" }}
        onSave={async () => ({ ok: true, status: "busy", personalMessage: "hello" })}
      />,
    );
    expect(html).toContain("Available");
    expect(html).toContain("Busy");
    expect(html).toContain('value="hello"');
    expect(html).toContain("5/80");
  });

  it("shows a validation message and disables save for an over-long draft", () => {
    const html = renderToStaticMarkup(
      <StatusEditor
        initial={{ status: "available", personalMessage: "x".repeat(81) }}
        onSave={async () => ({ ok: false, code: "validation_failed" })}
      />,
    );
    expect(html).toContain("at most 80 characters");
    expect(html).toContain("disabled");
  });

  it("error messages state that the previous status is unchanged", () => {
    for (const c of ["timeout", "validation_failed", "network_error"]) {
      expect(saveErrorMessage(c)).toContain("unchanged");
    }
  });
});

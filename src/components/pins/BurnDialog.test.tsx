import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BurnDialog } from "./BurnDialog";
import { GhostAnimation } from "./GhostAnimation";
describe("BurnDialog", () => {
  it("is an accessible modal with label, permanence warning, confirm and cancel", () => {
    const html = renderToStaticMarkup(
      <BurnDialog label="Marketplace" pin="0A1B2C3D" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Marketplace");
    expect(html).toContain("permanently");
    expect(html).toContain("Cancel");
    expect(html).toContain("Burn PIN");
  });
  it("shows the error text", () => {
    const html = renderToStaticMarkup(
      <BurnDialog label="X" pin="0A1B2C3D" error="did not complete" onConfirm={() => {}} onCancel={() => {}} />,
    );
    expect(html).toContain("did not complete");
  });
});
describe("GhostAnimation", () => {
  it("renders a status overlay", () => {
    expect(renderToStaticMarkup(<GhostAnimation onComplete={() => {}} reducedMotion />)).toContain("ghost-animation");
  });
});

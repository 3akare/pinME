import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PinCard } from "./PinCard";

const noop = async () => undefined;

describe("PinCard", () => {
  it("shows label, PIN and a contact count of 0 when there are none", () => {
    const html = renderToStaticMarkup(
      <PinCard pin="0A1B2C3D" label="Work" contactCount={0} onOpen={() => {}} onRename={noop} />,
    );
    expect(html).toContain("Work");
    expect(html).toContain("0A1B2C3D");
    expect(html).toMatch(/0\s*(<!-- -->)?\s*contacts/);
  });

  it("uses singular for one contact and offers rename and details", () => {
    const html = renderToStaticMarkup(
      <PinCard pin="0A1B2C3D" label="Work" contactCount={1} onOpen={() => {}} onRename={noop} />,
    );
    expect(html).toMatch(/1\s*(<!-- -->)?\s*contact</);
    expect(html).toContain("Rename");
    expect(html).toContain("Details");
  });
});

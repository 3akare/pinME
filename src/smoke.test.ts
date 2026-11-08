// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const root = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

function parseJsonc(text: string): any {
  let out = "";
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

describe("wrangler.jsonc (Req 18.5, 20.1)", () => {
  const cfg = parseJsonc(read("wrangler.jsonc"));
  it("has DO bindings, migrations and nodejs_compat", () => {
    expect(cfg.compatibility_flags).toContain("nodejs_compat");
    const bindings = cfg.durable_objects.bindings.map((b: any) => b.class_name);
    expect(bindings).toContain("PinMailbox");
    expect(cfg.migrations.length).toBeGreaterThan(0);
    const classes = cfg.migrations.flatMap((m: any) => m.new_sqlite_classes ?? m.new_classes ?? []);
    expect(classes).toContain("PinMailbox");
  });
});

describe("package scripts (Req 20.2)", () => {
  it("defines required scripts", () => {
    const scripts = JSON.parse(read("package.json")).scripts;
    for (const s of ["dev", "build", "deploy", "test", "lint", "db:generate", "db:migrate", "cf-typegen"]) {
      expect(scripts[s], s).toBeTruthy();
    }
  });
});

describe("dev vars (Req 20.3)", () => {
  it(".dev.vars is gitignored and example has DATABASE_URL without value", () => {
    const lines = read(".gitignore").split(/\r?\n/).map((l) => l.trim());
    expect(lines).toContain(".dev.vars");
    const ex = read(".dev.vars.example").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL"));
    expect(ex).toBeDefined();
    expect(ex!.split("=")[1]?.trim() ?? "").toBe("");
  });
});

describe("README (Req 18.9, 18.10, 20.5)", () => {
  const readme = read("README.md");
  it("has required sections", () => {
    for (const h of [/^#+\s*No forward secrecy/im, /^#+\s*What the server can see/im, /^#+\s*Burn guarantee/im, /^#+\s*Known limitations/im, /^#+\s*Setup/im]) {
      expect(readme).toMatch(h);
    }
    expect(readme).toContain("DATABASE_URL");
  });
});

describe("theme contrast (Req 14.8)", () => {
  const css = read("src/styles.css");
  const token = (n: string) => {
    const m = css.match(new RegExp(`--color-${n}:\\s*(#[0-9a-fA-F]{6})`));
    if (!m) throw new Error(`missing token ${n}`);
    return m[1];
  };
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  it.each([
    ["text", "bg"],
    ["muted", "bg"],
    ["accent", "bg"],
    ["on-accent", "accent"],
    ["text", "surface"],
    ["muted", "surface"],
  ])("%s on %s >= 4.5:1", (fg, bg) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("lint import restrictions (Req 18.12, 18.13)", () => {
  const eslint = new ESLint({ cwd: root });
  const lint = async (code: string, filePath: string) => {
    const [res] = await eslint.lintText(code, { filePath: resolve(root, filePath) });
    return res.messages.filter((m) => m.severity === 2).map((m) => `${m.ruleId}: ${m.message}`);
  };

  it("rejects durable importing from client", async () => {
    const msgs = await lint(`import { x } from "../client/x";\nexport const y = x;\n`, "src/durable/tmp.ts");
    expect(msgs.join("\n")).toMatch(/no-restricted-imports.*must not import from src\/client/);
  });
  it("rejects libsodium outside src/client/crypto", async () => {
    const msgs = await lint(`import s from "libsodium-wrappers";\nexport const y = s;\n`, "src/client/app/tmp.ts");
    expect(msgs.join("\n")).toMatch(/libsodium-wrappers may only be imported under src\/client\/crypto/);
  });
  it("rejects idb outside src/client/storage", async () => {
    const msgs = await lint(`import { openDB } from "idb";\nexport const y = openDB;\n`, "src/client/app/tmp.ts");
    expect(msgs.join("\n")).toMatch(/idb may only be imported under src\/client\/storage/);
  });
  it("rejects console.log in src/server", async () => {
    const msgs = await lint(`console.log("x");\n`, "src/server/tmp.ts");
    expect(msgs.join("\n")).toMatch(/no-console/);
  });
  it("allows libsodium inside src/client/crypto", async () => {
    const msgs = await lint(`import s from "libsodium-wrappers";\nexport const y = s;\n`, "src/client/crypto/tmp.ts");
    expect(msgs.join("\n")).not.toMatch(/no-restricted-imports/);
  });
});

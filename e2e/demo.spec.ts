import { neon } from "@neondatabase/serverless";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { findDatabaseUrl } from "./support/dbUrl";

// Requirement 25: the two-window demo flow, run against a real Neon database.
const DATABASE_URL = findDatabaseUrl();

const RUN = Date.now().toString(36);
const NAME_A = "Alice";
const NAME_B = "Bob";
const MSG_A = `hello-from-a-${RUN}`;
const MSG_B = `reply-from-b-${RUN}`;
// Unique per run: a common word could also appear in page copy (the landing page uses "Marketplace").
const PIN_LABEL = `Stall-${RUN}`;
const DEMO_BUDGET_MS = 180_000;

interface Traffic {
  chunks: string[];
  pending: Promise<unknown>[];
}

/** Records request URLs and bodies, API/document response bodies and WebSocket frames. */
function captureTraffic(context: BrowserContext): Traffic {
  const t: Traffic = { chunks: [], pending: [] };
  context.on("request", (req) => {
    t.chunks.push(req.url(), req.postData() ?? "");
  });
  context.on("response", (res) => {
    const type = res.request().resourceType();
    if (type !== "fetch" && type !== "xhr" && type !== "document") return;
    t.pending.push(
      res
        .text()
        .then((body) => t.chunks.push(body))
        .catch(() => undefined),
    );
  });
  context.on("page", (page) => {
    page.on("websocket", (ws) => {
      const push = (f: { payload: string | Buffer }) => t.chunks.push(f.payload.toString());
      ws.on("framesent", push);
      ws.on("framereceived", push);
    });
  });
  return t;
}

async function onboard(page: Page, name: string): Promise<{ pin: string; link: string }> {
  await page.goto("/onboarding");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create my PIN" }).click();
  // Onboarding lands in the chats with "My code" open.
  const sheet = page.getByRole("dialog", { name: "My code" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  const pin = (await sheet.locator("figcaption").innerText()).trim();
  expect(pin).toMatch(/^[0-9A-F]{8}$/);
  const link = await sheet.locator("#my-link").inputValue();
  expect(link).toContain(`/i/${pin}#`);
  await sheet.getByRole("button", { name: "Close" }).click();
  return { pin, link };
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.locator("#message-text").fill(text);
  await page.locator("#message-text").press("Enter");
}

const chatRow = (page: Page, name: string) => page.getByRole("list", { name: "Chats" }).getByRole("button", { name: new RegExp(name) });
const bubble = (page: Page, text: string) => page.getByTestId("message-bubble").filter({ hasText: text });

test.skip(
  !DATABASE_URL,
  "DATABASE_URL is not set in the environment or .dev.vars; the e2e demo needs a real Neon Postgres database.",
);

test("two-window demo: link connect, typed request, chat, ping, burn; server sees no plaintext", async ({ browser }) => {
  test.setTimeout(240_000);
  const sql = neon(DATABASE_URL!);
  const startedAt = Date.now();

  // Two isolated browser contexts = two devices with separate IndexedDB (Req 25.1).
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const trafficA = captureTraffic(ctxA);
  const trafficB = captureTraffic(ctxB);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  try {
    // Each window gets its own identity and code.
    const a1 = await onboard(a, NAME_A);
    const b1 = await onboard(b, NAME_B);
    expect(a1.pin).not.toBe(b1.pin);

    // B opens A's link (what scanning A's code does): no invite to send, no accept step.
    await b.goto(a1.link);
    await expect(b.locator("#message-text")).toBeVisible({ timeout: 15_000 });
    await expect(chatRow(a, NAME_B)).toBeVisible({ timeout: 10_000 });

    // A sends while B is on the chat list: D appears (Req 25.3), then R when B opens the chat.
    await b.goto("/");
    await expect(chatRow(b, NAME_A)).toBeVisible();
    await expect(b.getByText(/^Connecting\./)).toHaveCount(0, { timeout: 15_000 });
    await chatRow(a, NAME_B).click();
    await sendText(a, MSG_A);
    const sentA = bubble(a, MSG_A);
    await expect(sentA.locator('[data-marker="D"]')).toBeVisible({ timeout: 2000 });
    await chatRow(b, NAME_A).click();
    await expect(bubble(b, MSG_A)).toBeVisible({ timeout: 10_000 });
    await expect(sentA.locator('[data-marker="R"]')).toBeVisible({ timeout: 10_000 });

    // B replies; A has the chat open so the reply ends up read.
    await sendText(b, MSG_B);
    await expect(bubble(a, MSG_B)).toBeVisible({ timeout: 10_000 });
    await expect(bubble(b, MSG_B).locator('[data-marker="R"]')).toBeVisible({ timeout: 10_000 });

    // A sends a PING; B's chat window shakes (the shake lasts 1 s, so poll per frame).
    const shook = b.waitForFunction(() => !!document.querySelector("main.pinme-shake"), undefined, {
      polling: "raf",
      timeout: 10_000,
    });
    await a.getByRole("button", { name: "Send PING" }).click();
    await shook;

    // A creates the "Marketplace" PIN.
    await a.goto("/pins");
    await a.getByLabel("PIN label").fill(PIN_LABEL);
    await a.getByRole("button", { name: "Create PIN" }).click();
    const card = a.getByRole("article", { name: `PIN ${PIN_LABEL}` });
    await expect(card).toBeVisible();
    const marketPin = (await card.getByTestId("pin-value").innerText()).trim();
    expect(marketPin).toMatch(/^[0-9A-F]{8}$/);

    // B types the Marketplace PIN by hand: that one needs A's single Accept, offered wherever A is.
    await b.goto("/");
    await b.getByRole("button", { name: "Scan a code" }).click();
    await b.getByLabel("Or type their PIN").fill(marketPin);
    await b.getByRole("button", { name: "Chat", exact: true }).click();
    await expect(b.getByRole("heading", { name: new RegExp(`Request sent to ${NAME_A}`) })).toBeVisible({ timeout: 15_000 });
    await a.getByRole("button", { name: "Accept" }).click({ timeout: 10_000 });

    // B's waiting page opens the chat on its own once accepted.
    await expect(b).toHaveURL(new RegExp(`/chat/${marketPin}$`), { timeout: 15_000 });
    await expect(b.locator("#message-text")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByRole("button", { name: "Send PING" })).toBeEnabled({ timeout: 15_000 });

    // A burns the Marketplace PIN with the ghost animation.
    await a.goto("/pins");
    await a.getByRole("article", { name: `PIN ${PIN_LABEL}` }).getByRole("button", { name: "Details" }).click();
    await a.getByRole("button", { name: "Burn this PIN" }).click();
    await a.getByRole("dialog").getByRole("button", { name: "Burn PIN" }).click();
    await expect(a.getByTestId("ghost-animation")).toBeVisible({ timeout: 10_000 });

    // B's chat becomes unavailable and the input disappears within 2 s (Req 25.4).
    await expect(b.getByText("This contact is unavailable.")).toBeVisible({ timeout: 2000 });
    await expect(b.locator("#message-text")).toHaveCount(0);

    // B can no longer send to the burned PIN: no input, no PING, and no message was added (Req 25.5).
    await expect(b.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
    await expect(b.getByRole("button", { name: "Send PING" })).toHaveCount(0);
    await expect(b.getByTestId("message-bubble")).toHaveCount(0);

    // Whole demo within the time budget with no error indication (Req 25.2).
    expect(Date.now() - startedAt).toBeLessThanOrEqual(DEMO_BUDGET_MS);
    for (const page of [a, b]) {
      await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ })).toHaveCount(0);
    }

    // Directory and traffic contain no plaintext (Req 25.6).
    await Promise.allSettled([...trafficA.pending, ...trafficB.pending]);
    const traffic = [...trafficA.chunks, ...trafficB.chunks].join("\n");
    expect(traffic.length).toBeGreaterThan(0);
    for (const secret of [MSG_A, MSG_B, PIN_LABEL]) expect(traffic).not.toContain(secret);

    const tables = ["pins", "burned_pins", "invites", "contacts", "used_nonces"];
    const rows: Record<string, unknown[]> = {};
    for (const table of tables) rows[table] = await sql.query(`select * from ${table}`);
    const directory = JSON.stringify(rows);
    for (const secret of [MSG_A, MSG_B, PIN_LABEL]) expect(directory).not.toContain(secret);
    // The burn is recorded in the Directory.
    expect(JSON.stringify(rows.burned_pins)).toContain(marketPin);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

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
const PIN_LABEL = "Marketplace";
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

async function onboard(page: Page, name: string): Promise<string> {
  await page.goto("/onboarding");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create my PIN" }).click();
  await expect(page.getByRole("heading", { name: `You are set, ${name}` })).toBeVisible();
  const pin = (await page.locator("figcaption").innerText()).trim();
  expect(pin).toMatch(/^[0-9A-F]{8}$/);
  return pin;
}

async function openHome(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Contacts", exact: true })).toBeVisible();
}

async function sendInvite(page: Page, toPin: string): Promise<void> {
  await page.getByRole("link", { name: "Add contact" }).click();
  await page.getByLabel("Contact PIN").fill(toPin);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent.")).toBeVisible();
  await page.getByRole("link", { name: "Back to contacts" }).click();
}

async function acceptInviteFrom(page: Page, fromPin: string): Promise<void> {
  const row = page.getByRole("listitem").filter({ hasText: `Invite from ${fromPin}` });
  await expect(row).toBeVisible({ timeout: 10_000 });
  await row.getByRole("button", { name: "Accept" }).click();
  // Accepting opens the chat with the new contact.
  await expect(page.locator("#message-text")).toBeVisible({ timeout: 10_000 });
}

async function sendText(page: Page, text: string): Promise<void> {
  await page.locator("#message-text").fill(text);
  const send = page.getByRole("button", { name: "Send", exact: true });
  await expect(send).toBeEnabled({ timeout: 10_000 });
  await send.click();
}

const bubble = (page: Page, text: string) => page.getByTestId("message-bubble").filter({ hasText: text });

test.skip(
  !DATABASE_URL,
  "DATABASE_URL is not set in the environment or .dev.vars; the e2e demo needs a real Neon Postgres database.",
);

test("two-window demo: add, chat, ping, burn; server sees no plaintext", async ({ browser }) => {
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
    // Window A shows its PIN; window B has its own identity.
    const pinA = await onboard(a, NAME_A);
    const pinB = await onboard(b, NAME_B);
    expect(pinA).not.toBe(pinB);
    await openHome(a);
    await openHome(b);

    // B adds A, A accepts.
    await sendInvite(b, pinA);
    await acceptInviteFrom(a, pinB);
    await expect(b.getByRole("button", { name: new RegExp(NAME_A) })).toBeVisible({ timeout: 10_000 });

    // A sends while B is on the contact list: D appears (Req 25.3), then R when B opens the chat.
    await sendText(a, MSG_A);
    const sentA = bubble(a, MSG_A);
    await expect(sentA.locator('[data-marker="D"]')).toBeVisible({ timeout: 2000 });
    await b.getByRole("button", { name: new RegExp(NAME_A) }).click();
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
    await a.getByRole("link", { name: "Back", exact: true }).click();
    await a.getByRole("link", { name: "My PINs" }).first().click();
    await a.getByLabel("PIN label").fill(PIN_LABEL);
    await a.getByRole("button", { name: "Create PIN" }).click();
    const card = a.getByRole("article", { name: `PIN ${PIN_LABEL}` });
    await expect(card).toBeVisible();
    const marketPin = (await card.locator("p.font-mono").innerText()).trim();
    expect(marketPin).toMatch(/^[0-9A-F]{8}$/);

    // A switches to the Marketplace PIN so it can receive and accept the invite.
    await a.getByRole("link", { name: "Back to contacts" }).click();
    await a.locator("#activePin").selectOption(marketPin);

    // B adds the Marketplace PIN, A accepts.
    await b.getByRole("link", { name: "Back", exact: true }).click();
    await sendInvite(b, marketPin);
    await acceptInviteFrom(a, pinB);

    // B opens the chat with the Marketplace PIN and waits until it is connected.
    await b.goto(`/chat/${marketPin}`);
    await expect(b.locator("#message-text")).toBeVisible({ timeout: 15_000 });
    await expect(b.getByRole("button", { name: "Send PING" })).toBeEnabled({ timeout: 15_000 });

    // A burns the Marketplace PIN with the ghost animation.
    await a.getByRole("link", { name: "Back", exact: true }).click();
    await a.getByRole("link", { name: "My PINs" }).first().click();
    const marketCard = a.getByRole("article", { name: `PIN ${PIN_LABEL}` });
    await marketCard.getByRole("button", { name: "Details" }).click();
    await a.getByRole("button", { name: "Burn this PIN" }).click();
    await a.getByRole("dialog").getByRole("button", { name: "Burn PIN" }).click();
    await expect(a.getByTestId("ghost-animation")).toBeVisible({ timeout: 10_000 });

    // B's chat becomes unavailable and the input disappears within 2 s (Req 25.4).
    await expect(b.getByText("This contact is unavailable.")).toBeVisible({ timeout: 2000 });
    await expect(b.locator("#message-text")).toHaveCount(0);

    // B can no longer send to the burned PIN: no input, no PING, and no message was added (Req 25.5).
    // The UI exposes no send path at all once the contact is unavailable.
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

import { expect, test, type Page } from "@playwright/test";
import { findDatabaseUrl } from "./support/dbUrl";

test.skip(!findDatabaseUrl(), "DATABASE_URL is not set; the e2e flows need a real Neon Postgres database.");

async function onboard(page: Page, name: string): Promise<string> {
  await page.goto("/onboarding");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Display name").fill(name);
  await page.getByRole("button", { name: "Create my PIN" }).click();
  const sheet = page.getByRole("dialog", { name: "My code" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  const link = await sheet.locator("#my-link").inputValue();
  await sheet.getByRole("button", { name: "Close" }).click();
  return link;
}

const bubble = (page: Page, text: string) => page.getByTestId("message-bubble").filter({ hasText: text });
const chatRow = (page: Page, name: string) => page.getByRole("list", { name: "Chats" }).getByRole("button", { name: new RegExp(name) });

test("a group lets members who are not contacts talk to each other", async ({ browser }) => {
  test.setTimeout(180_000);
  const run = Date.now().toString(36);
  const ctx = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  try {
    const [host, bo, cy] = await Promise.all(ctx.map((c) => c.newPage()));
    const hostLink = await onboard(host!, "Host");
    await onboard(bo!, "Bo");
    await onboard(cy!, "Cy");

    // Bo and Cy each connect to Host by link; they are not each other's contacts.
    for (const p of [bo!, cy!]) {
      await p.goto(hostLink);
      await expect(p.locator("#message-text")).toBeVisible({ timeout: 15_000 });
    }
    await expect(chatRow(host!, "Bo")).toBeVisible({ timeout: 10_000 });
    await expect(chatRow(host!, "Cy")).toBeVisible({ timeout: 10_000 });

    // Host makes the group.
    const name = `Trip ${run}`;
    await host!.getByRole("button", { name: "More" }).click();
    await host!.getByRole("button", { name: "New group" }).click();
    await host!.getByLabel("Group name").fill(name);
    await host!.getByRole("checkbox", { name: /Bo/ }).check();
    await host!.getByRole("checkbox", { name: /Cy/ }).check();
    await host!.getByRole("button", { name: "Make group" }).click();
    await expect(host!.getByRole("heading", { name })).toBeVisible({ timeout: 15_000 });

    // Both members get the group; Bo writes, Cy (no contact of Bo) reads it, and replies.
    for (const p of [bo!, cy!]) {
      await p.goto("/");
      await expect(chatRow(p, name)).toBeVisible({ timeout: 15_000 });
    }
    await chatRow(bo!, name).click();
    await bo!.locator("#message-text").fill(`hello from bo ${run}`);
    await bo!.locator("#message-text").press("Enter");
    await chatRow(cy!, name).click();
    await expect(bubble(cy!, `hello from bo ${run}`)).toBeVisible({ timeout: 15_000 });
    await cy!.locator("#message-text").fill(`hi bo, cy here ${run}`);
    await cy!.locator("#message-text").press("Enter");
    await expect(bubble(bo!, `hi bo, cy here ${run}`)).toBeVisible({ timeout: 15_000 });
    await expect(bubble(host!, `hi bo, cy here ${run}`)).toBeVisible({ timeout: 15_000 });

    // Bo leaves; the others see it.
    await bo!.getByRole("button", { name: "Leave", exact: true }).click();
    await bo!.getByRole("button", { name: "Leave group" }).click();
    await expect(chatRow(bo!, name)).toHaveCount(0, { timeout: 15_000 });
    await expect(cy!.getByRole("log", { name: "Conversation" }).getByText("Bo left.")).toBeVisible({ timeout: 15_000 });
  } finally {
    await Promise.all(ctx.map((c) => c.close()));
  }
});

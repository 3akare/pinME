import { expect, test } from "@playwright/test";
import { findDatabaseUrl } from "./support/dbUrl";

test.skip(!findDatabaseUrl(), "DATABASE_URL is not set; the e2e flows need a real Neon Postgres database.");

test("back up on one device, restore on another: same PIN, connected", async ({ browser }) => {
  test.setTimeout(120_000);
  const pass = `correct horse ${Date.now()}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  try {
    const a = await ctxA.newPage();
    await a.goto("/onboarding");
    await a.waitForLoadState("networkidle");
    await a.getByLabel("Display name").fill("Restorer");
    await a.getByRole("button", { name: "Create my PIN" }).click();
    const sheet = a.getByRole("dialog", { name: "My code" });
    await expect(sheet).toBeVisible({ timeout: 15_000 });
    const pin = (await sheet.locator("figcaption").innerText()).trim();
    await sheet.getByRole("button", { name: "Close" }).click();

    await a.getByRole("button", { name: "More" }).click();
    await a.getByRole("button", { name: "Back up" }).click();
    await a.getByLabel("Passphrase", { exact: true }).fill(pass);
    await a.getByLabel("Passphrase again").fill(pass);
    const download = a.waitForEvent("download");
    await a.getByRole("button", { name: "Download backup" }).click();
    const file = await (await download).path();

    const b = await ctxB.newPage();
    await b.goto("/restore");
    await b.waitForLoadState("networkidle");
    await b.getByLabel("Backup file").setInputFiles(file!);
    await b.getByLabel("Passphrase").fill("not the passphrase");
    await b.getByRole("button", { name: "Restore" }).click();
    await expect(b.getByRole("alert").filter({ hasText: "Wrong passphrase" })).toBeVisible({ timeout: 30_000 });

    await b.getByLabel("Passphrase").fill(pass);
    await b.getByRole("button", { name: "Restore" }).click();
    await expect(b.getByRole("heading", { name: "Chats" })).toBeVisible({ timeout: 30_000 });
    await expect(b.locator("figcaption").filter({ hasText: pin })).toBeVisible();
    await expect(b.getByText(/^Connecting\./)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

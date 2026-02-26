import { expect, test } from "@playwright/test";

async function waitForAppReady() {
  await expect.poll(async () => {
    const response = await fetch("http://localhost:5000/api/health");
    if (!response.ok) return "down";
    const json = await response.json();
    return json.status;
  }, { timeout: 30000 }).toBe("ok");
}

test.beforeAll(async () => {
  await waitForAppReady();
});

test("dashboard navigation uses stable test ids", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("nav-links")).toBeVisible();

  await page.getByTestId("nav-templates").click();
  await expect(page).toHaveURL(/\/templates/);
  await expect(page.locator('[data-testid^="card-template-"]').first()).toBeVisible();

  await page.getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByTestId("label-theme-dark")).toBeVisible();
});

test("template flow creates a PRD and opens editor", async ({ page }) => {
  const prdTitle = `Smoke PRD ${Date.now()}`;

  await page.goto("/templates");
  await page.getByTestId("card-template-feature").click();

  await expect(page.getByTestId("input-prd-title")).toBeVisible();
  await page.getByTestId("input-prd-title").fill(prdTitle);
  await page.getByTestId("button-create-prd").click();

  await expect(page).toHaveURL(/\/editor\//);
  await expect(page.getByTestId("input-title")).toHaveValue(prdTitle);
  await expect(page.getByTestId("button-save")).toBeVisible();
});

test("editor and settings interactions stay stable via test ids", async ({ page }) => {
  await page.goto("/");
  const firstCard = page.locator('[data-testid^="card-prd-"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();

  await expect(page).toHaveURL(/\/editor\//);
  await page.getByTestId("button-dual-ai-assist").click();
  await expect(page.getByTestId("dialog-dual-ai")).toBeVisible();
  await page.getByTestId("button-dual-ai-cancel").click();

  await page.getByTestId("button-share").click();
  await expect(page.getByTestId("dialog-share-prd")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/settings");
  await page.getByTestId("label-theme-dark").click();
  await expect.poll(async () => (await page.locator("html").getAttribute("class")) || "").toContain("dark");
  await page.getByTestId("label-theme-light").click();
});

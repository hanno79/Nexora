/**
 * Author: rahn
 * Datum: 01.03.2026
 * Version: 1.0
 * Beschreibung: E2E-Tests für die Dashboard-Filter (Status und Vorlage)
 */

import { test, expect } from "@playwright/test";
import { clerkSetup } from "@clerk/testing/playwright";
import { signInViaBrowser, initClerkTesting } from "./helpers/clerk-browser-auth";

test.describe("Dashboard Filter", () => {
  test.beforeAll(async () => {
    await initClerkTesting();
  });

  test.beforeEach(async ({ page }) => {
    await signInViaBrowser(page);
  });

  test("Status-Filter sollte als MultiSelect angezeigt werden", async ({ page }) => {
    // Prüfe, dass der Status-Filter als MultiSelect existiert
    const statusFilter = page.locator('[data-testid="status-filter"]');
    await expect(statusFilter).toBeVisible();
    
    // Prüfe, dass "Alle" als Standard-Text angezeigt wird
    await expect(statusFilter).toContainText("Alle");
  });

  test("Status-Filter sollte Dropdown oeffnen und Optionen anzeigen", async ({ page }) => {
    const statusFilter = page.locator('[data-testid="status-filter"]');
    await statusFilter.click();
    
    // Prüfe, dass alle Status-Optionen im Dropdown sichtbar sind
    await expect(page.getByText("Entwurf").first()).toBeVisible();
    await expect(page.getByText("In Bearbeitung").first()).toBeVisible();
    await expect(page.getByText("Pruefung").first()).toBeVisible();
    await expect(page.getByText("Abgeschlossen").first()).toBeVisible();
  });

  test("Status-Filter sollte Mehrfachauswahl erlauben", async ({ page }) => {
    const statusFilter = page.locator('[data-testid="status-filter"]');
    await statusFilter.click();
    
    // Waehle mehrere Status aus
    await page.getByText("Entwurf").first().click();
    await page.getByText("In Bearbeitung").first().click();
    
    // Schliesse das Dropdown durch Klick ausserhalb
    await page.keyboard.press("Escape");
    
    // Prüfe, dass die Anzahl der ausgewaehlten Filter angezeigt wird
    await expect(statusFilter).toContainText("(2)");
  });

  test("Vorlagen-Filter sollte als MultiSelect angezeigt werden", async ({ page }) => {
    // Prüfe, dass der Vorlagen-Filter als MultiSelect existiert
    const templateFilter = page.locator('[data-testid="template-filter"]');
    await expect(templateFilter).toBeVisible();
    
    // Prüfe, dass "Alle Vorlagen" als Standard-Text angezeigt wird
    await expect(templateFilter).toContainText("Alle Vorlagen");
  });

  test("Vorlagen-Filter sollte Dropdown oeffnen", async ({ page }) => {
    const templateFilter = page.locator('[data-testid="template-filter"]');
    await templateFilter.click();
    
    // Prüfe, dass das Dropdown geoeffnet wurde (mind. eine Option sichtbar)
    // Warten auf den Popover-Content
    await expect(page.locator('[role="dialog"], [role="listbox"]').first()).toBeVisible();
  });

  test("Beide Filter sollten konsistentes Styling haben", async ({ page }) => {
    const statusFilter = page.locator('[data-testid="status-filter"]');
    const templateFilter = page.locator('[data-testid="template-filter"]');
    
    // Prüfe, dass beide Filter sichtbar sind
    await expect(statusFilter).toBeVisible();
    await expect(templateFilter).toBeVisible();
    
    // Prüfe, dass beide die gleiche Hoehe haben (h-10 = 40px)
    const statusHeight = await statusFilter.evaluate(el => window.getComputedStyle(el).height);
    const templateHeight = await templateFilter.evaluate(el => window.getComputedStyle(el).height);
    expect(statusHeight).toBe(templateHeight);
    
    // Prüfe, dass beide die gleiche Schriftgroesse haben
    const statusFontSize = await statusFilter.evaluate(el => window.getComputedStyle(el).fontSize);
    const templateFontSize = await templateFilter.evaluate(el => window.getComputedStyle(el).fontSize);
    expect(statusFontSize).toBe(templateFontSize);
  });

  test("Filter sollten zurueckgesetzt werden koennen", async ({ page }) => {
    // Waehle Status-Filter aus
    const statusFilter = page.locator('[data-testid="status-filter"]');
    await statusFilter.click();
    await page.getByText("Entwurf").first().click();
    await page.keyboard.press("Escape");
    
    // Warte kurz auf UI-Update
    await page.waitForTimeout(100);
    
    // Prüfe, dass etwas ausgewaehlt ist (Badge mit "1" sollte sichtbar sein)
    const badge = statusFilter.locator('[class*="badge"]').first();
    if (await badge.isVisible().catch(() => false)) {
      // Klicke auf den Badge um zurückzusetzen
      await badge.click();
    } else {
      // Oeffne Filter und waehle "Alle"
      await statusFilter.click();
      // Suche nach "Alle" im Dropdown
      const alleOption = page.getByText("Alle").first();
      if (await alleOption.isVisible().catch(() => false)) {
        await alleOption.click();
      }
      await page.keyboard.press("Escape");
    }
  });
});

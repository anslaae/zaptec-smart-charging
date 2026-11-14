import { expect, test, type Page } from "@playwright/test";

// HANDOFF §6f: the app is "Smart lading", the mode is "Smart", and a cold
// start of the installed app plays the start-up animation. A browser tab isn't
// the installed app, so these tests ask for it with `?splash`.

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/login")) {
    await page.getByRole("button", { name: "Roger" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("§6f: the app is called Smart lading (title, manifest)", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Smart lading");
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ name: "Smart lading", short_name: "Smart lading", background_color: "#0E0F0D" });
  expect(manifest.short_name.length).toBeLessThanOrEqual(12);
});

test("§6f: no splash in a browser tab, or on a warm start", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByTestId("splash")).toBeHidden();
});

test("§6f: a cold start plays the animation to the end, then fades to Hjem", async ({ page }) => {
  await page.goto("/?splash");
  const splash = page.getByRole("status", { name: "Starter Smart lading" });
  await expect(splash).toBeVisible();
  await expect(splash.getByText("Smart lading")).toBeAttached();
  // Hjem is ready well before 1.8 s here, but the animation is never cut off.
  await page.waitForTimeout(1_000);
  await expect(splash).toBeVisible();
  await expect(splash).toBeHidden({ timeout: 5_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Only once per app start: a tab switch doesn't bring it back.
  await page.getByRole("navigation", { name: "Hovedmeny" }).getByRole("link", { name: "Historikk" }).click();
  await expect(page.getByRole("heading", { name: "Historikk", level: 1 })).toBeVisible();
  await expect(page.getByTestId("splash")).toBeHidden();
});

test("§6f: with reduced motion the final frame shows at once, without animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?splash");
  const name = page.getByTestId("splash").getByText("Smart lading");
  await expect(name).toHaveCSS("opacity", "1");
  await expect(page.locator(".splash-arc")).toHaveCSS("stroke-dashoffset", "0px");
  await expect(page.getByTestId("splash")).toBeHidden({ timeout: 5_000 });
});

test("§6f: the mode is just 'Smart' in Innstillinger", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText(/^(Vent på plan|Lad med en gang|Smart · .+) ›$/)).toBeVisible();
  await page.getByRole("button", { name: /Når bilen kobles til/ }).click();
  await expect(page.getByRole("radio", { name: /^Smart Billigst mulig/ })).toBeVisible();
});

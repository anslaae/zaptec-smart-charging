import { expect, test, type Page } from "@playwright/test";

// D80: one loading pattern on every screen. The server is slowed down here
// (each client-side navigation / refresh request waits SLOW_MS) so the
// in-between states are long enough to see.

const SLOW_MS = 1_500;

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/login")) {
    await page.getByRole("button", { name: "Roger" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}

/** Delays the app's RSC requests (navigations and router.refresh), not page loads. */
async function slowServer(page: Page, match: (url: URL) => boolean = () => true) {
  await page.route(
    (url) => match(url),
    async (route) => {
      if (route.request().headers()["rsc"] === "1" && route.request().headers()["next-router-prefetch"] == null) {
        await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      }
      await route.continue();
    },
  );
}

const bar = (page: Page) => page.getByTestId("progress-bar");

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("D80: tapping År shows at once, keeps the month dimmed, then shows the year", async ({ page }) => {
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Innsikt" })).toBeVisible();
  await expect(bar(page)).toHaveAttribute("data-active", "false");
  await slowServer(page);

  const year = page.getByRole("navigation", { name: /periode/i }).getByRole("link", { name: "År" });
  await year.click();
  // The tapped control answers at once...
  await expect(year.locator('[data-pending="true"]')).toBeVisible({ timeout: 500 });
  // ...the month stays, dimmed, and the top bar runs while the year loads.
  await expect(page.getByTestId("pending-area")).toHaveAttribute("aria-busy", "true");
  await expect(bar(page)).toHaveAttribute("data-active", "true", { timeout: 1_000 });
  await expect(page.getByTestId("pending-area")).toHaveCSS("opacity", "0.5");

  await expect(page).toHaveURL(/year=\d{4}/);
  await expect(year).toHaveAttribute("aria-current", "page");
  await expect(year.locator('[data-pending="true"]')).toHaveCount(0);
  await expect(page.getByTestId("pending-area")).toHaveAttribute("aria-busy", "false");
  await expect(bar(page)).toHaveAttribute("data-active", "false");
});

test("D80: ‹ in Innsikt and Historikk's segments use the same pending state", async ({ page }) => {
  await page.goto("/insights");
  await slowServer(page);
  const prev = page.getByRole("link", { name: "Forrige måned" });
  await prev.click();
  await expect(prev.locator('[data-pending="true"]')).toBeVisible({ timeout: 500 });
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await expect(page.getByTestId("pending-area")).toHaveAttribute("aria-busy", "false");

  await page.goto("/history");
  const plans = page.getByRole("link", { name: "Planer" });
  await plans.click();
  await expect(plans.locator('[data-pending="true"]')).toBeVisible({ timeout: 500 });
  await expect(page.getByTestId("pending-area")).toHaveAttribute("aria-busy", "true");
  await expect(page).toHaveURL(/tab=plans/);
  await expect(plans).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("pending-area")).toHaveAttribute("aria-busy", "false");
});

test("D80: Hjem's background refresh shows in the top bar, and clears again", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Mock mode refreshes Hjem every 3 s; a slow refresh is visible while it runs.
  await slowServer(page, (url) => url.pathname === "/");
  await expect(bar(page)).toHaveAttribute("data-active", "true", { timeout: 6_000 });
  await expect(bar(page)).toHaveAttribute("data-active", "false", { timeout: 4_000 });
});

test("D80: a tab whose screen isn't cached shows that screen's own placeholder at once", async ({ page }) => {
  // No prefetching, and a slow server: the worst case for a tab tap.
  await page.route(
    () => true,
    async (route) => {
      const headers = route.request().headers();
      if (headers["next-router-prefetch"] != null) return route.abort();
      if (headers["rsc"] === "1") await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
      await route.continue();
    },
  );
  await page.goto("/insights");
  await expect(page.getByRole("heading", { name: "Innsikt" })).toBeVisible();
  const menu = page.getByRole("navigation", { name: "Hovedmeny" });

  for (const [tab, screen, heading] of [
    ["Historikk", "history", "Historikk"],
    ["Innstillinger", "settings", "Innstillinger"],
    ["Innsikt", "insights", "Innsikt"],
  ] as const) {
    await menu.getByRole("link", { name: tab }).click();
    await expect(page.getByTestId(`skeleton-${screen}`)).toBeVisible({ timeout: 500 });
    // Never Hjem's outline on another screen.
    await expect(page.getByTestId("skeleton-home")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByTestId(`skeleton-${screen}`)).toHaveCount(0);
  }
});

test("D80: Hjem shown again after a while stays in place, dimmed, until the fresh copy arrives", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("navigation", { name: "Hovedmeny" }).getByRole("link", { name: "Innstillinger" }).click();
  await expect(page.getByRole("heading", { name: "Innstillinger", level: 1 })).toBeVisible();
  // Back to the cached Hjem once it's older than D71's 10 s.
  await page.waitForTimeout(11_000);
  await slowServer(page);
  await page.goBack();
  const hero = page.locator("section.stale-dim");
  await expect(hero).toHaveAttribute("data-stale", "true");
  await expect(page.getByTestId("freshness")).toHaveText("Oppdaterer…");
  await expect(hero).not.toHaveAttribute("data-stale", "true", { timeout: 15_000 });
});

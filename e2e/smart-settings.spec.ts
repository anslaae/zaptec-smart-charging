import { expect, test, type Page } from "@playwright/test";

// HANDOFF §6g: Smart on Hjem (smartIdle, the override row) and Innstillinger →
// Bil og lader with its two detail pages. Mock mode only.

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/login")) {
    await page.getByRole("button", { name: "Roger" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}

async function newestLogSeq(page: Page): Promise<number> {
  const first = page.locator("[data-log-seq]").first();
  return (await first.count()) ? Number(await first.getAttribute("data-log-seq")) : 0;
}

async function untilNewLogLine(page: Page, text: string, act: () => Promise<void>) {
  const before = await newestLogSeq(page);
  await act();
  await expect
    .poll(async () => {
      for (const li of await page.locator("[data-log-seq]").all()) {
        if (Number(await li.getAttribute("data-log-seq")) <= before) break;
        if ((await li.textContent())?.includes(text)) return true;
      }
      return false;
    })
    .toBe(true);
}

async function preset(page: Page, label: string) {
  await page.goto("/dev/mock");
  await untilNewLogLine(page, `Scenario: ${label}`, () => page.getByRole("button", { name: label, exact: true }).click());
}

async function resetAll(page: Page) {
  await page.goto("/dev/mock");
  await page.getByRole("button", { name: "Nullstill alt til startdata", exact: true }).click();
  await expect(page.getByText("Alt nullstilt til startdata")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  await resetAll(page);
  await page.close();
});

test.beforeEach(async ({ page }) => {
  page.on("dialog", (dialog) => {
    throw new Error(`Unexpected browser dialog: ${dialog.message()}`);
  });
  await login(page);
});

test("6g smartIdle: Smart card with the 'Kobler du til nå' preview, compact battery row, one small Lag egen plan", async ({ page }) => {
  await preset(page, "Smart på – ingen bil");
  await page.goto("/");
  const idle = page.getByTestId("smart-idle");
  await expect(idle).toBeVisible();
  // Compact battery row: % in the ring, "Ikke tilkoblet", kWh left, the unplug line with km
  await expect(idle.getByRole("img", { name: /^Batteri 62\s%, sist målt/ })).toBeVisible();
  await expect(idle.getByText("Ikke tilkoblet", { exact: true })).toBeVisible();
  await expect(idle.getByText(/^ca\. \d+ kWh igjen$/)).toBeVisible();
  await expect(idle.getByText(/^Koblet fra .+ · ca\. 41 km siden$/)).toBeVisible();

  const card = page.getByTestId("smart-card");
  await expect(card.getByText("Smart er på", { exact: true })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Lader automatisk når bilen kobles til" })).toBeVisible();
  await expect(card.getByText(/^Til 80\s% innen \d\d:\d\d .+, i de billigste timene\. Aldri 16–21\.$/)).toBeVisible();
  const previewRow = page.getByTestId("smart-preview");
  await expect(previewRow.getByText("Kobler du til nå")).toBeVisible();
  await expect(previewRow.getByText(/^ca\. \d\d:\d\d–\d\d:\d\d$/)).toBeVisible();
  await expect(previewRow.getByText(/^ca\. \d+ kr · klar \d\d:\d\d$/)).toBeVisible();

  // No filled button; the old "Planlegg lading" is gone. One outline "Lag egen plan".
  await expect(page.getByRole("link", { name: "Planlegg lading" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lad nå" })).toHaveCount(0);
  await expect(page.getByText("Trenger du noe annet i natt?")).toBeVisible();
  await page.getByRole("link", { name: "Lag egen plan" }).click();
  await expect(page.getByRole("dialog", { name: "Planlegg lading" })).toBeVisible();
  await page.getByRole("dialog", { name: "Planlegg lading" }).getByRole("button", { name: "Lukk" }).click();

  // "Endre ›" opens the Smart sheet
  await page.getByRole("button", { name: "Endre Smart" }).click();
  await expect(page.getByRole("dialog", { name: "Når bilen kobles til" })).toBeVisible();
});

test("6g: 'Vent på plan' without a car is unchanged (filled Planlegg lading, no Smart card)", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Planlegg lading" })).toBeVisible();
  await expect(page.getByTestId("smart-idle")).toHaveCount(0);
});

test("6g: Smart waiting with the car: tinted card, 'Smart er på', and the Overstyr for i natt row", async ({ page }) => {
  await preset(page, "Smart lading – venter");
  await page.goto("/");
  await expect(page.getByText("Smart er på", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Endre for i natt" })).toHaveCount(0);
  const row = page.getByRole("group", { name: "Overstyr for i natt" });
  await expect(row).toBeVisible();
  const plan = row.getByRole("link", { name: "Egen plan" });
  const chargeNow = row.getByRole("button", { name: "Lad nå" });
  const preheat = row.getByRole("button", { name: "Forvarm" });
  // Three equal 44 px buttons
  const boxes = await Promise.all([plan, chargeNow, preheat].map((l) => l.boundingBox()));
  for (const box of boxes) {
    expect(Math.round(box!.height)).toBe(44);
    expect(Math.abs(box!.width - boxes[0]!.width)).toBeLessThan(1.5);
  }
  await plan.click();
  await expect(page.getByRole("dialog", { name: "Endre plan" })).toBeVisible();
  await page.getByRole("dialog", { name: "Endre plan" }).getByRole("button", { name: "Lukk" }).click();
  await chargeNow.click();
  await expect(page.getByText("Lading startet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
});

test("6g Innstillinger: Bil og lader first, Lært ladeeffekt and the health line gone from System", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/settings");
  const headings = page.getByRole("heading", { level: 2 });
  await expect(headings.first()).toHaveText("Bil og lader");
  await expect(page.getByRole("link", { name: /Opel Mokka-e.*62\s% · koblet fra .+ · data / })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ingen feil · regner med [\d,]+ kW i planer/ })).toBeVisible();
  await expect(page.getByText("Lært ladeeffekt")).toHaveCount(0);
  await expect(page.getByText(/Tilkoblet · ingen feil/)).toHaveCount(0);
});

test("6g Bil page: header, Fra bilen, Ved laderen and the footnote", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/settings");
  await page.getByRole("link", { name: /Opel Mokka-e/ }).click();
  await expect(page).toHaveURL(/\/settings\/car$/);
  await expect(page.getByRole("heading", { level: 1, name: "Opel Mokka-e" })).toBeVisible();
  const header = page.getByTestId("car-header");
  await expect(header.getByRole("img", { name: "62\u202F%" })).toBeVisible();
  await expect(header.getByText("Ikke tilkoblet")).toBeVisible();
  await expect(header.getByText(/målt i dag \d\d:\d\d · ca\. \d+ kWh igjen/)).toBeVisible();
  await expect(header.getByText(/batteri \d+ kWh/)).toBeVisible();

  await expect(page.getByRole("region", { name: "Fra bilen" }).getByText(/^[\d\s]+ km$/)).toBeVisible();
  await expect(page.getByText("ca. 41 km", { exact: true })).toBeVisible();
  await expect(page.getByText("Smartcar", { exact: true })).toBeVisible();
  await expect(page.getByText(/^sist oppdatert /)).toBeVisible();

  const atCharger = page.getByRole("region", { name: "Ved laderen" });
  await expect(atCharger.getByText(/koblet fra · var tilkoblet/)).toBeVisible();
  await expect(atCharger.getByText(/^[\d,]+ kWh · .+/).first()).toBeVisible();
  await expect(atCharger.getByText(/^\d+ ladinger$|^1 lading$/)).toBeVisible();
  await expect(page.getByText(/kommer fra bilen via Smartcar/)).toBeVisible();

  await page.getByRole("link", { name: "Innstillinger" }).first().click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("6g Lader page: Regner med, the fallback chain with the one in use, status and last power", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/settings");
  await page.getByRole("link", { name: /regner med/ }).click();
  await expect(page).toHaveURL(/\/settings\/charger$/);
  await expect(page.getByText("Regner med", { exact: true })).toBeVisible();
  await expect(page.getByTestId("planned-kw")).toHaveText(/^[\d,]+ kW$/);
  await expect(page.getByText("når en plan skal starte")).toBeVisible();

  // Learned rate: a dot per sample with the count line, or the empty text without history.
  const plot = page.getByTestId("power-plot");
  if (await plot.count()) {
    const count = Number(await plot.getAttribute("data-count"));
    await expect(plot.locator("[data-dot]")).toHaveCount(count);
    await expect(page.getByText(count === 1 ? /^Den siste planen som ladet uten pause/ : new RegExp(`^Median av de ${count} siste planene`))).toBeVisible();
  }

  const chain = page.locator("ol li");
  await expect(chain).toHaveCount(4);
  await expect(chain.nth(0)).toContainText("Målt nå");
  await expect(chain.nth(1)).toContainText("Lært fra planer");
  await expect(chain.nth(2)).toContainText("Kursens maks");
  await expect(chain.nth(3)).toContainText("Standard");
  // No car, nothing charging: exactly one step is in use and the reason says why.
  await expect(page.locator('ol li[aria-current="true"]')).toHaveCount(1);
  const active = await page.locator('ol li[aria-current="true"]').getAttribute("data-source");
  expect(["learned", "circuit"]).toContain(active);
  await expect(page.getByTestId("chain-reason")).toHaveText(
    active === "learned" ? "Nå: ingen bil tilkoblet, så den lærte effekten brukes." : "Nå: for lite historikk, så kursens maks brukes.",
  );
  await expect(page.getByText("Jeg bruker den første som finnes.")).toBeVisible();

  const status = page.getByRole("region", { name: "Status" });
  await expect(status.getByText(/^Tilkoblet · ingen feil/)).toBeVisible();
  await expect(status.getByText("Siste effekt målt")).toBeVisible();
});

test("6g Lader page: while charging the measured power is the one in use", async ({ page }) => {
  await preset(page, "Lad nå");
  await page.goto("/settings/charger");
  await expect(page.locator('ol li[aria-current="true"]')).toHaveAttribute("data-source", "observed");
  await expect(page.getByTestId("chain-reason")).toHaveText("Nå: laderen lader, så den målte effekten brukes.");
});

test("6g smartIdle without any battery reading hides the preview row", async ({ page }) => {
  await preset(page, "Smart på – ingen bil, ingen batteridata");
  await page.goto("/");
  await expect(page.getByTestId("smart-card")).toBeVisible();
  await expect(page.getByText("Ingen bil tilkoblet", { exact: true })).toBeVisible();
  await expect(page.getByTestId("smart-preview")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Lag egen plan" })).toBeVisible();
  // Put the stored readings back for whatever runs next.
  await resetAll(page);
});

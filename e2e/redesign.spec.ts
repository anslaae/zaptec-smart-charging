import { expect, test, type Page } from "@playwright/test";

// End-to-end checks of the redesigned screens (design/redesign/HANDOFF.md),
// run against mock mode -- nothing here can reach a real charger.

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().endsWith("/login")) {
    await page.getByRole("button", { name: "Roger" }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  }
}

// The panel shows the newest 40 log lines, so counting lines breaks once
// older ones scroll out. Each line carries an ever-increasing data-log-seq:
// wait for a line newer than the newest one before the action.
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
  await untilNewLogLine(page, `Scenario: ${label}`, () =>
    page.getByRole("button", { name: label, exact: true }).click(),
  );
}

async function mockButton(page: Page, name: string) {
  if (!page.url().endsWith("/dev/mock")) await page.goto("/dev/mock");
  await page.getByRole("button", { name, exact: true }).click();
}

async function tick(page: Page) {
  if (!page.url().endsWith("/dev/mock")) await page.goto("/dev/mock");
  await untilNewLogLine(page, "Cron-tick: 200", () => mockButton(page, "Kjør cron-tick"));
}

async function freshLog(page: Page) {
  // The mock log keeps the newest 200 lines; tests that count many ticks'
  // commands start from a clean slate (and clean data).
  await mockButton(page, "Nullstill alt til startdata");
  await expect(page.getByText("Alt nullstilt til startdata")).toBeVisible();
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  await login(page);
  await mockButton(page, "Nullstill alt til startdata");
  await expect(page.getByText("Alt nullstilt til startdata")).toBeVisible();
  await page.close();
});

test.beforeEach(async ({ page }) => {
  // The app has its own confirm dialog; a native browser dialog is a regression.
  page.on("dialog", (dialog) => {
    throw new Error(`Unexpected browser dialog: ${dialog.message()}`);
  });
  await login(page);
});

test("UC1/UC3: create, edit and cancel a plan in the plan sheet", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/");
  await expect(page.getByText("Tilkoblet – ingen plan")).toBeVisible();

  await page.getByRole("link", { name: "Planlegg lading" }).click();
  const sheet = page.getByRole("dialog", { name: "Planlegg lading" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "90 %" }).click();
  await expect(sheet.getByText(/^\+\d+,\d kWh$/)).toBeVisible();
  await sheet.getByRole("button", { name: "Lagre plan" }).click();

  await expect(page.getByText("Plan lagret")).toBeVisible();
  await expect(page.getByText(/^Starter ca\. \d\d:\d\d · klar /)).toBeVisible();
  await expect(page.getByText(/^Planlagt/)).toBeVisible();
  await expect(page.getByText("mål 90 %")).toBeVisible();

  // Edit: the sheet opens prefilled with the saved target
  await page.getByRole("link", { name: "Endre plan" }).click();
  const edit = page.getByRole("dialog", { name: "Endre plan" });
  await expect(edit.getByRole("button", { name: "90 %" })).toHaveAttribute("aria-pressed", "true");
  await edit.getByRole("button", { name: "100 %" }).click();
  await edit.getByRole("button", { name: "Lagre plan" }).click();
  await expect(page.getByText("mål 100 %")).toBeVisible();

  // Cancel from the sheet
  await page.getByRole("link", { name: "Endre plan" }).click();
  await page.getByRole("dialog", { name: "Endre plan" }).getByRole("button", { name: "Avbryt plan" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Avbryte planen?" });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText(/^100 % klar \d\d:\d\d i morgen slettes/)).toBeVisible();
  await expect(confirm.getByRole("button", { name: "Behold" })).toBeFocused();
  await confirm.getByRole("button", { name: "Avbryt plan" }).click();
  await expect(page.getByText("Plan avbrutt", { exact: true })).toBeVisible();
  await expect(page.getByText("Tilkoblet – ingen plan")).toBeVisible();

  // Angre on the toast brings the plan back
  await page.getByRole("button", { name: "Angre" }).click();
  await expect(page.getByText("Planen er tilbake")).toBeVisible();
  await expect(page.getByText("mål 100 %")).toBeVisible();
});

test("plan sheet blocks a target at or below the battery", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/?sheet=plan");
  const sheet = page.getByRole("dialog", { name: "Planlegg lading" });
  await sheet.locator("#battery-now").fill("95");
  await sheet.getByRole("button", { name: "90 %" }).click();
  await expect(sheet.getByText("Målet må være høyere enn batteriet nå.")).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Lagre plan" })).toBeDisabled();
});

test("UC2: planning without a car says it starts when the car is connected", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/?sheet=plan");
  await expect(page.getByRole("dialog").getByText(/Starter når bilen kobles til/)).toBeVisible();
});

test("/schedule/quick redirects to the plan sheet", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/schedule/quick");
  await expect(page).toHaveURL(/\/\?sheet=plan$/);
  await expect(page.getByRole("dialog", { name: "Planlegg lading" })).toBeVisible();
});

test("UC8: Forvarm starts power and opens the Forvarm sheet", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/");
  await page.getByRole("button", { name: "Forvarm bilen" }).click();
  const sheet = page.getByRole("dialog", { name: "Forvarm bilen" });
  await expect(sheet.getByText("Strøm til bilen er på")).toBeVisible();
  await expect(sheet.getByText(/^Startet \d\d:\d\d/)).toBeVisible();
  await expect(sheet.getByRole("link", { name: /Åpne myOpel/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Stopp strøm" }).click();
  await page.getByRole("alertdialog", { name: "Stoppe forvarmingen?" }).getByRole("button", { name: "Stopp forvarming" }).click();
  await expect(page.getByText("Lading stoppet")).toBeVisible();
});

test("UC5: Lad nå push action asks before starting", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/?action=charge-now");
  const sheet = page.getByRole("dialog", { name: "Lad nå?" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "Lad nå" }).click();
  await expect(page.getByText("Lading startet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
});

test("Lad nå with a plan asks, then cancels the plan and charges", async ({ page }) => {
  await preset(page, "Planlagt");
  await page.goto("/");
  await page.getByRole("button", { name: "Lad nå" }).click();
  const confirm = page.getByRole("dialog", { name: "Lad nå i stedet for planen?" });
  await expect(confirm.getByText(/^Planen \(klar .+\) blir avbrutt/)).toBeVisible();
  await confirm.getByRole("button", { name: "Avbryt plan og lad" }).click();
  await expect(page.getByText("Lading startet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
  await page.goto("/history?tab=activity");
  await expect(page.getByText("Plan avbrutt").first()).toBeVisible();
});

test("declining the question keeps the plan and doesn't start anything", async ({ page }) => {
  await preset(page, "Planlagt");
  await page.goto("/");
  await page.getByRole("button", { name: "Forvarm bilen" }).click();
  await page
    .getByRole("dialog", { name: "Forvarme i stedet for planen?" })
    .getByRole("button", { name: "Behold" })
    .click();
  await expect(page.getByText(/^Planlagt/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("Forvarm and Lad nå sheets warn that an open plan will be cancelled", async ({ page }) => {
  await preset(page, "Planlagt");
  await page.goto("/?action=charge-now");
  await expect(page.getByRole("dialog").getByText(/Dette avbryter planen/)).toBeVisible();
  await page.goto("/?sheet=preheat");
  const sheet = page.getByRole("dialog", { name: "Forvarm bilen" });
  await expect(sheet.getByText(/Dette avbryter planen/)).toBeVisible();
  await sheet.getByRole("button", { name: "Forvarm bilen" }).click();
  await expect(sheet.getByText(/^Startet \d\d:\d\d/)).toBeVisible();
  await expect(sheet.getByText(/Dette avbryter planen/)).toHaveCount(0);
});

test("plug-in without a plan sends the Planlegg / Lad nå push", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await tick(page);
  await mockButton(page, "Koble til bil");
  await tick(page);
  await expect(page.getByText(/Bilen er koblet til — Batteri \d+ %/)).toBeVisible();
  await expect(page.getByText(/StopChargingFinal/).first()).toBeVisible();
});

test("Historikk: Økter, Planer and Aktivitet segments", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Historikk" })).toBeVisible();
  await expect(page.getByText("Denne uken", { exact: true })).toBeVisible();
  await expect(page.getByText("Forrige uke", { exact: true })).toBeVisible();
  await expect(page.getByText("Oktober", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Planer" }).click();
  await expect(page.getByText("Fullført").first()).toBeVisible();

  await page.getByRole("link", { name: "Aktivitet" }).click();
  await expect(page.getByText("Bil koblet til").first()).toBeVisible();
});

test("Innsikt: KPIs, chart, per person and month navigation", async ({ page }) => {
  await page.goto("/insights");
  await expect(page.getByText("Energi hittil")).toBeVisible();
  await expect(page.getByText("Kostnad hittil")).toBeVisible();
  await expect(page.getByText("Per person")).toBeVisible();
  await page.getByRole("link", { name: "Forrige måned" }).click();
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await expect(page.getByText("Gjest", { exact: true })).toBeVisible();
});

test("Innsikt 6c: car chip and Kjøring card from the odometer", async ({ page }) => {
  await page.goto("/insights");
  await expect(page.getByText("Opel Mokka-e", { exact: true })).toBeVisible();
  await expect(page.getByText("Gjestelading telles separat")).toBeVisible();
  const drive = page.getByRole("region", { name: "Kjøring" });
  await expect(drive.getByText(/^km-stand [\d\s\u00a0]+ · målt /)).toBeVisible();
  await expect(drive.getByText(/^kjørt i /)).toBeVisible();
  await expect(drive.getByText(/^\d+,\d km\/kWh$/)).toBeVisible();
  await expect(drive.getByText(/^\d+,\d\d kWh\/mil$/)).toBeVisible();
  await expect(drive.getByText(/^ca\. \d+,\d\d kr\/mil$/)).toBeVisible();
  // Last month: the seeded charge elsewhere is left out and counted in the footnote
  await page.getByRole("link", { name: "Forrige måned" }).click();
  await expect(page.getByRole("region", { name: "Kjøring" }).getByText(/lading et annet sted er holdt utenfor/)).toBeVisible();
});

test("Historikk 6c: rows start with the car's short name", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByText(/^Mokka-e · \d+ → \d+ %$/).first()).toBeVisible();
});

test("UC14: 'Lad med en gang' lets an unplanned session run", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/settings");
  await page.getByRole("button", { name: /Når bilen kobles til/ }).click();
  const sheet = page.getByRole("dialog", { name: "Når bilen kobles til" });
  await sheet.getByRole("radio", { name: /Lad med en gang/ }).check();
  // Both automatic choices pick a target % (owner decision D51)
  await expect(sheet.getByText("Lader til 80 % med en gang («Automatisk»)")).toBeVisible();
  await sheet.getByRole("button", { name: "70 %" }).click();
  await sheet.getByRole("button", { name: "Lagre" }).click();
  // No "Hvor lenge?" dialog any more
  await expect(page.getByText("Lagret", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Lad med en gang · 70 % ›")).toBeVisible();
  await expect(page.getByText(/kan da lade/)).toBeVisible();

  // Battery 62 %, target 70 % of 46 kWh → stops after ~3,7 kWh
  await tick(page);
  await mockButton(page, "Koble til bil");
  await tick(page);
  await page.goto("/");
  await expect(page.getByText(/^Lader automatisk/)).toBeVisible();
  for (let i = 0; i < 4; i++) await mockButton(page, "+1 kWh");
  await tick(page);
  await expect(page.getByText(/StopChargingFinal/).first()).toBeVisible();
  await page.goto("/history?tab=activity");
  await expect(page.getByText("Automatisk lading nådde målet").first()).toBeVisible();

  // Back to "Vent på plan" doesn't ask
  await page.goto("/settings");
  await page.getByRole("button", { name: /Når bilen kobles til/ }).click();
  await page.getByRole("dialog", { name: "Når bilen kobles til" }).getByRole("radio", { name: /Vent på plan/ }).check();
  await page.getByRole("dialog", { name: "Når bilen kobles til" }).getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByText("Lagret", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("UC16: Smart lading plans the night on plug-in and shows it on Hjem", async ({ page }) => {
  await preset(page, "Smart lading – venter");
  // The real tick planned it and sent smart_planned
  await expect(page.getByText(/Smart lading i natt — Lader til 80 % \d\d:\d\d–\d\d:\d\d · ca\. \d+ kr\./)).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Smart lading", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Lader (i natt )?\d\d:\d\d–\d\d:\d\d$/)).toBeVisible();
  await expect(page.getByText(/^Klar til \d\d:\d\d .+ · \+[\d,]+ kWh$/)).toBeVisible();
  await expect(page.getByText("Kveldstopp", { exact: true })).toBeVisible();
  // The saving vs charging now only exists while "now" is daytime rate; late in the
  // evening charging now is nearly all night rate, so the line is (rightly) hidden.
  const osloHour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Oslo" }).format(new Date()));
  if (osloHour >= 6 && osloHour < 20) await expect(page.getByText(/sparer ca\. \d+ kr og kveldstoppen/)).toBeVisible();
  await expect(page.getByText(/^ca\. \d+ kr$/)).toBeVisible();
  // "Endre for i natt" opens the plan sheet for this row
  await page.getByRole("link", { name: "Endre for i natt" }).click();
  await expect(page.getByRole("dialog", { name: "Endre plan" })).toBeVisible();
  await page.getByRole("dialog", { name: "Endre plan" }).getByRole("button", { name: "Lukk" }).click();
  // Lad nå takes over without asking
  await page.getByRole("button", { name: "Lad nå" }).click();
  await expect(page.getByText("Lading startet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
  await page.goto("/history?tab=activity");
  await expect(page.getByText("Smart lading avbrutt for denne ladingen").first()).toBeVisible();
  await expect(page.getByText("Smart lading planlagt").first()).toBeVisible();
});

test("UC16: Avbryt for i natt stops Smart lading for this plug-in", async ({ page }) => {
  await preset(page, "Smart lading – lader");
  await page.goto("/");
  await expect(page.getByText("Smart lading", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Lader – ferdig ca\. \d\d:\d\d$/)).toBeVisible();
  await page.getByRole("button", { name: "Avbryt for i natt" }).click();
  await page.getByRole("alertdialog", { name: "Avbryte planen?" }).getByRole("button", { name: "Avbryt plan" }).click();
  await expect(page.getByText("Plan avbrutt", { exact: true })).toBeVisible();
  // Not planned again for the same plug-in
  await tick(page);
  await page.goto("/");
  await expect(page.getByText("Tilkoblet – ingen plan")).toBeVisible();
});

test("UC16: Smart lading settings in the Når bilen kobles til sheet", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/settings");
  await page.getByRole("button", { name: /Når bilen kobles til/ }).click();
  const sheet = page.getByRole("dialog", { name: "Når bilen kobles til" });
  await sheet.getByRole("radio", { name: /Smart lading/ }).check();
  await expect(sheet.getByText("Billigst: natt 22–06 og helg · 81 øre/kWh")).toBeVisible();
  await expect(sheet.getByText("Dyrest: hverdager 06–22 · 96 øre/kWh")).toBeVisible();
  await sheet.getByRole("button", { name: "90 %" }).click();
  await sheet.getByLabel("Klar til, hverdager").selectOption("07:00");
  await sheet.getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByText("Smart lading · 90 % innen 07:00 ›")).toBeVisible();
});

test("Innstillinger: price sources and the location name from Zaptec", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByText("Hentes fra Zaptec – endres i Zaptec-appen")).toBeVisible();
  await expect(page.getByRole("button", { name: /Navn på stedet/ })).toHaveCount(0);
  await page.getByText("Hvor kommer tallene fra?").click();
  await expect(page.getByText(/Elvias standard tariff for forbrukerkunder fra 1\. juli 2026/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Elvias nettleiepriser ↗" })).toHaveAttribute("href", /elvia\.no/);
});

test("UC15: lending the charger shows the guest state until it ends", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Lån ut", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Låne ut laderen?" });
  await dialog.getByRole("textbox").fill("Nabo i nr. 3");
  await dialog.getByRole("button", { name: "Lån ut" }).click();
  await expect(page.getByText("Laderen er lånt ut", { exact: true })).toBeVisible();
  await expect(page.getByText(/Lånt ut til Nabo i nr\. 3/)).toBeVisible();

  await page.goto("/");
  await expect(page.getByText("Lånt ut – venter på gjesten")).toBeVisible();
  await expect(page.getByText(/^Lånt ut til Nabo i nr\. 3 · /)).toBeVisible();
  await page.getByRole("button", { name: "Avslutt utlån" }).click();
  await expect(page.getByText("Utlånet er avsluttet")).toBeVisible();
  await expect(page.getByText("Ikke tilkoblet").first()).toBeVisible();
});

test("Innstillinger: price change shows up in costs", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: /Pris per kWh/ }).click();
  await page.getByLabel("Pris per kWh").fill("1,00");
  await page.getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByText("Strømprisen er lagret")).toBeVisible();
  await expect(page.getByText("1,00 kr/kWh")).toBeVisible();
  await page.goto("/insights");
  // Energy at 1,00 kr/kWh plus Elvia nettleie
  await expect(page.getByText(/^strøm \d+ kr · nettleie \d+ kr$/)).toBeVisible();
});

test("no console errors on the main screens", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  for (const path of ["/", "/?sheet=plan", "/history", "/history?tab=plans", "/insights", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
  }
  expect(errors).toEqual([]);
});

test("Bruk reuses last plan's target % and time, from the battery now", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/");
  await expect(page.getByText(/^Til 80 % \(\+\d+,\d kWh\) · klar \d\d:\d\d i morgen$/)).toBeVisible();
  await page.getByRole("button", { name: "Bruk" }).click();
  await expect(page.getByText("Plan lagret")).toBeVisible();
  await expect(page.getByText("mål 80 %")).toBeVisible();
});

test("lending and plans are mutually exclusive", async ({ page }) => {
  await preset(page, "Planlagt");
  await page.goto("/settings");
  await page.getByRole("button", { name: "Lån ut", exact: true }).click();
  const lend = page.getByRole("dialog", { name: "Låne ut laderen?" });
  await expect(lend.getByText(/Planen \(klar .+\) blir avbrutt\./)).toBeVisible();
  await lend.getByRole("button", { name: "Lån ut" }).click();
  await expect(page.getByText(/Lånt ut nå/)).toBeVisible();

  // While lent out: no plan sheet, but Lad nå works as usual
  await page.goto("/?sheet=plan");
  const sheet = page.getByRole("dialog", { name: "Laderen er lånt ut" });
  await expect(sheet.getByText(/Avslutt utlånet for å planlegge/)).toBeVisible();
  await sheet.getByRole("button", { name: "Lukk" }).click();
  // The plugged-in car was taken as the guest's and started; Stopp / Lad nå work as usual
  await page.getByRole("button", { name: "Stopp lading" }).click();
  // Guest car: the dialog doesn't claim to know its battery %
  const stop = page.getByRole("alertdialog", { name: "Stoppe ladingen?" });
  await expect(stop.getByText(/^Bilen har fått [\d,]+ kWh\. Den lader ikke mer/)).toBeVisible();
  await stop.getByRole("button", { name: "Stopp lading" }).click();
  await expect(page.getByText("Lading stoppet")).toBeVisible();
  // Stopping didn't end the lending
  await expect(page.getByRole("button", { name: "Avslutt utlån" })).toBeVisible();
  await page.getByRole("button", { name: "Lad nå" }).click();
  await expect(page.getByText("Lading startet")).toBeVisible();
  await page.getByRole("button", { name: "Avslutt utlån" }).click();
  await expect(page.getByText("Utlånet er avsluttet")).toBeVisible();
});

test("nettleie: Elvia rates by default, editable, and can be left out", async ({ page }) => {
  await page.goto("/settings");
  // Elvia 2026 (HANDOFF §6b): 46,40 øre day, 31,40 øre night/weekend/holiday
  await expect(page.getByText("0,46 kr/kWh")).toBeVisible();
  await expect(page.getByText("0,31 kr/kWh")).toBeVisible();
  await page.goto("/insights");
  await expect(page.getByText(/^strøm \d+ kr · nettleie \d+ kr$/)).toBeVisible();
  await expect(page.getByText(/Norgespris \+ nettleie/)).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: /Nettleie dag/ }).click();
  await page.getByLabel(/Nettleie dag/).fill("0,40");
  await page.getByLabel(/Nettleie natt og helg/).fill("0,30");
  await page.getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByText("Nettleie er lagret")).toBeVisible();
  await expect(page.getByText("0,40 kr/kWh")).toBeVisible();

  // Both empty = costs without nettleie
  await page.getByRole("button", { name: /Nettleie dag/ }).click();
  await page.getByLabel(/Nettleie dag/).fill("");
  await page.getByLabel(/Nettleie natt og helg/).fill("");
  await page.getByRole("button", { name: "Lagre" }).click();
  await expect(page.getByText("Nettleie er lagret")).toBeVisible();
  await page.goto("/insights");
  await expect(page.getByText(/Nettleie er ikke lagt inn/)).toBeVisible();
});

test("Fullfør plan in the mock panel ends in the ready state with the push", async ({ page }) => {
  await preset(page, "Lader etter plan");
  await mockButton(page, "Fullfør plan");
  await expect(page.getByText(/Bilen er klar — Ladet til ca\. \d+ %/)).toBeVisible();
  await page.goto("/");
  // HANDOFF §3 ready: status without the %, ring at the reached %, "Siste lading"
  // (also listed in Siste hendelser, so take the status line, which comes first)
  await expect(page.getByText("Bilen er klar", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/^Ferdig \d\d:\d\d · .+ (før|etter) fristen \d\d:\d\d$/)).toBeVisible();
  await expect(page.getByText("mål nådd")).toBeVisible();
  await expect(page.getByText("Siste lading")).toBeVisible();
  // Design 6c: the line starts with the car
  await expect(page.getByText("Opel Mokka-e · plan av Roger")).toBeVisible();
  await expect(page.getByRole("link", { name: "Detaljer ›" })).toHaveAttribute("href", /\/history#session-/);
  await expect(page.getByRole("button", { name: "Lad nå" })).toBeVisible();
});

test("unplugged Hjem: last reading in the ring, kWh left and Koblet fra", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.goto("/");
  await expect(page.getByText("Ikke tilkoblet", { exact: true })).toBeVisible();
  await expect(page.getByText(/^ca\. \d+ kWh igjen$/)).toBeVisible();
  await expect(page.getByRole("img", { name: /^Batteri 62 %, sist målt \d\d:\d\d$/ })).toBeVisible();
  await expect(page.getByText(/^målt \d\d:\d\d$/)).toBeVisible();
  // Design 6c: since the unplug (26 h ago in the preset), with a day word, never a bare HH:MM
  const card = page.getByRole("region", { name: "Koblet fra" });
  await expect(card.getByText(/^i (dag|går) \d\d:\d\d$/)).toBeVisible();
  await expect(card.getByText("−18 %", { exact: true })).toBeVisible();
  await expect(card.getByText("ca. 41 km", { exact: true })).toBeVisible();
  await expect(card.getByText(/^i dag \d\d:\d\d · 62 %$/)).toBeVisible();
});

test("D64: a plan that has started keeps charging through ticks (no stop/start loop)", async ({ page }) => {
  await freshLog(page);
  // Started plan, ready tomorrow 07:30: hours early by any estimate, which
  // used to make the tick pause it (and resume it a minute later).
  await preset(page, "Lader etter plan");
  const stops = page.getByText(/\[command\] StopChargingFinal/);
  const before = await stops.count();
  await tick(page);
  await tick(page);
  await tick(page);
  await expect(stops).toHaveCount(before);
});

test("D64: a charger that won't start gets three tries, then one push", async ({ page }) => {
  await freshLog(page);
  await preset(page, "Lader etter plan");
  // Re-plug with RFID required: ResumeCharging can't start the new session
  await mockButton(page, "Koble fra bil");
  await page.getByText("Laderen krever innlogging (RFID)").click();
  await expect(page.getByRole("checkbox", { name: "Laderen krever innlogging (RFID)" })).toBeChecked();
  await mockButton(page, "Koble til bil");
  const resumes = page.getByText(/\[command\] ResumeCharging/);
  const push = page.getByText(/\[push\] Ladingen starter ikke/);
  const resumesBefore = await resumes.count();
  const pushesBefore = await push.count();
  for (let i = 0; i < 5; i++) await tick(page);
  await expect(resumes).toHaveCount(resumesBefore + 3);
  await expect(push).toHaveCount(pushesBefore + 1);
  // (Hjem shows its own "Appen styrer ikke laderen" card while RFID is
  // required; the D64 line on the planned card is covered by the debug scenario.)
  // Re-plugging resets the count: it tries again
  await page.goto("/dev/mock");
  await mockButton(page, "Koble fra bil");
  await mockButton(page, "Koble til bil");
  await tick(page);
  await expect(resumes).toHaveCount(resumesBefore + 4);
  await page.getByText("Laderen krever innlogging (RFID)").click();
  await expect(page.getByRole("checkbox", { name: "Laderen krever innlogging (RFID)" })).not.toBeChecked();
});

test("D64: Hjem tells you to re-plug when the plan gave up starting", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("zaptec-debug-enabled", "1");
    localStorage.setItem("zaptec-debug-scenario", "plannedStartFailed");
  });
  await page.reload();
  await expect(page.getByText("Laderen svarer ikke – koble bilen fra og til igjen")).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem("zaptec-debug-enabled");
    localStorage.removeItem("zaptec-debug-scenario");
  });
});

test("D65: Hjem shows the loop guard's pause and the plan's line", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.setItem("zaptec-debug-enabled", "1");
    localStorage.setItem("zaptec-debug-scenario", "plannedAutomationPaused");
  });
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Appen har tatt pause" })).toContainText(
    "Ladingen ble slått av og på for ofte",
  );
  await expect(page.getByText("Appen har tatt pause – koble bilen fra og til igjen")).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem("zaptec-debug-enabled");
    localStorage.removeItem("zaptec-debug-scenario");
  });
});

test("unplugged Hjem keeps the % when the Smartcar API fails (latest webhook reading)", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await page.getByText("Smartcar svarer ikke").click();
  await expect(page.getByRole("checkbox", { name: "Smartcar svarer ikke" })).toBeChecked();
  await page.goto("/");
  await expect(page.getByText("Ikke tilkoblet", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: /^Batteri 62 %, sist målt \d\d:\d\d$/ })).toBeVisible();
  // Tab away and back: still there
  await page.getByRole("link", { name: "Historikk" }).click();
  await expect(page.getByRole("heading", { name: "Historikk" })).toBeVisible();
  // Keyboard: the Next dev badge covers the Hjem tab at phone width in dev mode.
  await page.getByRole("link", { name: "Hjem" }).press("Enter");
  await expect(page.getByRole("img", { name: /^Batteri 62 %/ })).toBeVisible();
  await expect(page.getByText("Ingen bil tilkoblet")).toHaveCount(0);
});

test("Aktivitet leaves out the automatic stop after a plug-in; debug mode shows it (D63)", async ({ page }) => {
  await preset(page, "Ingen bil tilkoblet");
  await mockButton(page, "Koble til bil");
  await tick(page);
  await page.goto("/history?tab=activity");
  await expect(page.getByText("Bil koblet til").first()).toBeVisible();
  await expect(page.getByText("Automatisk lading stoppet (ingen plan)")).toHaveCount(0);
  await expect(page.getByText("Lading startet", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Lading stoppet", { exact: true })).toHaveCount(0);
  // Debug mode (Innstillinger → System) shows the charger's own events again
  await page.evaluate(() => localStorage.setItem("zaptec-debug-enabled", "1"));
  await page.reload();
  await expect(page.getByText("Automatisk lading stoppet (ingen plan)").first()).toBeVisible();
  await page.evaluate(() => localStorage.removeItem("zaptec-debug-enabled"));
});

test("Lad nå started twice is one session, and Stopp records its energy (D62)", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  // Earlier tests leave their own sessions and starts today: count from here.
  const sessionRows = page.locator("li").filter({ hasText: /I dag ·/ }).filter({ hasText: "Lad nå" }).filter({ hasText: /1,\d kWh/ });
  const startRows = page.locator("li").filter({ hasText: "Startet manuelt" }).filter({ hasText: /i dag/ });
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Historikk" })).toBeVisible();
  const sessionsBefore = await sessionRows.count();
  await page.goto("/history?tab=activity");
  await expect(page.getByRole("heading", { name: "Historikk" })).toBeVisible();
  const startsBefore = await startRows.count();

  await page.goto("/");
  await page.getByRole("button", { name: "Lad nå" }).click();
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
  // A second start (the push action) while it's already charging
  await page.goto("/?action=charge-now");
  await page.getByRole("dialog", { name: "Lad nå?" }).getByRole("button", { name: "Lad nå" }).click();
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
  // One kWh in, then stop from the app -- no tick in between
  await mockButton(page, "+1 kWh");
  await page.goto("/");
  await page.getByRole("button", { name: "Stopp lading" }).click();
  await page.getByRole("alertdialog", { name: "Stoppe ladingen?" }).getByRole("button", { name: "Stopp lading" }).click();
  await expect(page.getByText("Lading stoppet")).toBeVisible();
  await page.goto("/history");
  await expect(sessionRows).toHaveCount(sessionsBefore + 1);
  // The double start shows once in Aktivitet too
  await page.goto("/history?tab=activity");
  await expect(startRows).toHaveCount(startsBefore + 1);
});

test("Planer and Aktivitet are grouped like Økter; Se alle opens Aktivitet", async ({ page }) => {
  await page.goto("/history?tab=plans");
  await expect(page.getByText("Denne uken", { exact: true })).toBeVisible();
  await expect(page.getByText("Forrige uke", { exact: true })).toBeVisible();
  // Older plans sit in month rows that open
  const october = page.locator("details").filter({ hasText: /^Oktober/ });
  await expect(october.getByText(/^(\d+ planer|1 plan)/)).toBeVisible();
  await october.locator("summary").click();
  await expect(october.getByText("Fullført").first()).toBeVisible();

  await page.goto("/history?tab=activity");
  await expect(page.getByText("Denne uken", { exact: true })).toBeVisible();
  await expect(page.getByText(/^(\d+ hendelser|1 hendelse)/).first()).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("link", { name: "Se alle" })).toHaveAttribute("href", "/history?tab=activity");
});

test("Logg ut asks first; Avbryt keeps you logged in", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Logg ut" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Logge ut?" });
  await expect(dialog.getByText(/Varsler på denne enheten slås av/)).toBeVisible();
  await dialog.getByRole("button", { name: "Avbryt" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

test("a plan that's charging can't be edited, only stopped (D55)", async ({ page }) => {
  await preset(page, "Lader etter plan");
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Endre ›" })).toHaveCount(0);
  await page.goto("/?sheet=plan");
  const sheet = page.getByRole("dialog", { name: "Planen lader nå" });
  await expect(sheet.getByText(/kan ikke endres/)).toBeVisible();
  await sheet.getByRole("button", { name: "Avbryt plan" }).click();
  await page.getByRole("alertdialog", { name: "Avbryte planen?" }).getByRole("button", { name: "Avbryt plan" }).click();
  await expect(page.getByText("Plan avbrutt", { exact: true })).toBeVisible();
});

test("the plan sheet starts at 08:00 (D56)", async ({ page }) => {
  await preset(page, "Tilkoblet – ingen plan");
  await page.goto("/?sheet=plan");
  const sheet = page.getByRole("dialog", { name: "Planlegg lading" });
  await expect(sheet.getByRole("button", { name: "08:00" })).toHaveAttribute("aria-pressed", "true");
});

test("D67: Forvarm while a plan charges offers a hold, with what it may add", async ({ page }) => {
  for (const label of ["Lader etter plan", "Smart lading – lader"]) {
    await preset(page, label);
    await page.goto("/");
    await page.getByRole("link", { name: "Forvarm bilen" }).click();
    const sheet = page.getByRole("dialog", { name: "Forvarm bilen" });
    await expect(sheet.getByText("Strøm er på – lading pågår")).toBeVisible();
    // Before confirming: until when, and the extra kWh / kr at today's price
    await expect(
      sheet.getByText(/^Strømmen holdes på til \d\d:\d\d\. Bilen kan lade (forbi \d+ %|mer enn planen) i mellomtiden – ca\. \d+(,\d)? kWh \/ \d+ kr ekstra ved dagens pris\./),
    ).toBeVisible();
    await expect(sheet.getByText(/Dette avbryter planen/)).toHaveCount(0);
    await sheet.getByRole("button", { name: "Hold strømmen på" }).click();
    await expect(sheet.getByText(/^Strøm holdes på til \d\d:\d\d$/)).toBeVisible();
    // Hjem: the plan is kept, with the hold line
    await page.goto("/");
    await expect(page.getByText(/^Forvarming – strøm holdes på til \d\d:\d\d$/)).toBeVisible();
    if (label === "Lader etter plan") await expect(page.getByRole("button", { name: "Avbryt plan" })).toBeVisible();
    // A tick keeps it charging under the hold
    await tick(page);
    await page.goto("/");
    await expect(page.getByText(/^Forvarming – strøm holdes på til/)).toBeVisible();
  }
});

test("D67: Forvarm during Lad nå: power is already on, nothing to confirm", async ({ page }) => {
  await preset(page, "Lad nå");
  await page.goto("/");
  await page.getByRole("link", { name: "Forvarm bilen" }).click();
  const sheet = page.getByRole("dialog", { name: "Forvarm bilen" });
  await expect(sheet.getByText("Strøm er på – lading pågår")).toBeVisible();
  await expect(sheet.getByRole("button", { name: /Forvarm bilen|Hold strømmen på/ })).toHaveCount(0);
  await expect(sheet.getByRole("link", { name: /Åpne myOpel/ })).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Stopp lading" })).toBeVisible();
  await expect(page.getByText(/^Forvarming – strøm holdes på/)).toHaveCount(0);
});

test("D68: the car stops drawing during Forvarm: amber line, one push, cleared when it draws again", async ({ page }) => {
  await freshLog(page);
  await preset(page, "Forvarmer");
  await page.goto("/");
  await expect(page.getByText(/sluttet å trekke strøm/)).toHaveCount(0);

  await mockButton(page, "Bilen slutter å trekke strøm");
  await tick(page);
  const pushLine = page.locator("[data-log-seq]").filter({ hasText: "Forvarming bruker batteriet — Bilen sluttet å trekke strøm fra laderen kl." });
  await expect(pushLine).toHaveCount(1);
  await page.goto("/");
  await expect(page.getByText("Bilen har sluttet å trekke strøm – forvarmingen går nå på batteriet.")).toBeVisible();
  await page.goto("/?sheet=preheat");
  await expect(
    page.getByRole("dialog", { name: "Forvarm bilen" }).getByText("Bilen har sluttet å trekke strøm – forvarmingen går nå på batteriet."),
  ).toBeVisible();

  // Another tick: still on battery, but no second push
  await tick(page);
  await expect(pushLine).toHaveCount(1);

  await mockButton(page, "Bilen trekker strøm igjen");
  await tick(page);
  await page.goto("/");
  await expect(page.getByText(/sluttet å trekke strøm/)).toHaveCount(0);
});

test("D70: sessions imported from Zaptec show in Historikk with the car's short name", async ({ page }) => {
  await page.goto("/history");
  await expect(page.getByRole("heading", { name: "Historikk" })).toBeVisible();
  await page.locator("details").evaluateAll((els) => els.forEach((el) => ((el as HTMLDetailsElement).open = true)));
  const rows = page.locator("li").filter({ hasText: "Mokka-e · Importert fra Zaptec" });
  await expect(rows).toHaveCount(2);
  await expect(rows.first().getByText("Zaptec", { exact: true })).toBeVisible();
  await expect(rows.first().getByText(/kWh$/)).toBeVisible();
  await expect(rows.first().getByText(/\d+ kr$/)).toBeVisible();
});

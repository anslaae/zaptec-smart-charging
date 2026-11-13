// All Norwegian (nb) UI copy, from design/redesign/strings.nb.json. A typed
// object is enough for a one-language household app -- no i18n library.
// `{placeholders}` are filled with fill() below. Sections marked "(app)" are
// additions for screens the design file doesn't cover (login, toasts, debug).

export const nb = {
  app: {
    name: "Lading",
    greeting: {
      morning: "God morgen, {name}",
      day: "God dag, {name}",
      afternoon: "God ettermiddag, {name}",
      evening: "God kveld, {name}",
    },
  },
  nav: { home: "Hjem", history: "Historikk", insights: "Innsikt", settings: "Innstillinger", menuLabel: "Hovedmeny" },
  heartbeat: { ok: "Sist sjekket {time}", stale: "Planlegging er satt på pause – sist sjekket {time}", never: "Ikke sjekket ennå" },
  battery: {
    measured: "målt {time}",
    approx: "ca.",
    target: "mål {percent} %",
    last: "sist",
    derived: "Batteri beregnet fra {percent} % målt {time}",
    // (app) unplugged: the car's last reading and when it was taken
    lastMeasured: "sist målt {when}",
    lastMeasuredLabel: "Batteri {percent} %, sist målt {when}",
  },
  home: {
    noCar: {
      status: "Ikke tilkoblet",
      statusNoBattery: "Ingen bil tilkoblet",
      sub: "ca. {kwh} kWh igjen",
      subNoBattery: "Sist tilkoblet {when}",
      hint: "Du kan planlegge allerede nå. Ladingen starter når bilen kobles til.",
      primary: "Planlegg lading",
      sinceTitle: "Koblet fra",
      sinceBattery: "Batteri",
      sinceBatteryValue: "{change} %",
      sinceDriven: "Kjørt",
      sinceDrivenValue: "ca. {km} km",
      sinceMidnight: "midnatt",
      sinceEndLabel: "{when} · {percent} %",
    },
    connected: {
      status: "Tilkoblet – ingen plan",
      sub: "Bilen lader ikke før du planlegger eller trykker Lad nå",
      suggestion: "Forslag fra sist",
      useSuggestion: "Bruk",
      primary: "Planlegg lading",
      chargeNow: "Lad nå",
      preheat: "Forvarm bilen",
    },
    planWaiting: {
      status: "Plan klar – venter på bilen",
      sub: "Koble til innen {time} for å være klar {readyBy}",
      reminder: "Du får et varsel {time} hvis bilen fortsatt ikke er koblet til.",
      primary: "Endre plan",
      cancel: "Avbryt plan",
    },
    planned: {
      status: "Planlagt – starter ca. {time}",
      sub: "Klar til {readyBy} · +{kwh} kWh",
      timelineNote: "Jeg venter med å lade til det trengs, og regner med {kw} kW fra tidligere ladinger.",
      tooTight: "Rekker ikke helt – starter med en gang",
      primary: "Endre plan",
    },
    chargingPlan: {
      status: "Lader – ferdig ca. {time}",
      sub: "Klar til {readyBy} · {kw} kW",
      planRow: "Plan: {percent} % klar {readyBy}",
      edit: "Endre ›",
      primary: "Avbryt plan",
    },
    chargingManual: { status: "Lader nå · {kw} kW", primary: "Stopp lading" },
    preheating: {
      status: "Forvarmer – strøm fra laderen",
      sub: "Startet {time} · {kw} kW · {duration}",
      climatePrompt: "Har du startet klima?",
      climateSub: "Det gjøres i myOpel-appen.",
      openMyOpel: "Åpne myOpel ↗",
      primary: "Stopp forvarming",
      autoStopNote: "Stopper av seg selv når bilen kobles fra.",
    },
    ready: {
      status: "Bilen er klar",
      sub: "Ferdig {time} · {minutes} min før fristen {readyBy}",
      subLate: "Ferdig {time} · {minutes} min etter fristen {readyBy}",
      targetReached: "mål nådd",
      lastSession: "Siste lading",
      details: "Detaljer ›",
      from: "Fra",
      delivered: "Levert",
      duration: "Tid",
      cost: "Kostnad",
      byUser: "{car} · plan av {name}",
      // (app) no known person (smart plan): just the car
      byCar: "{car}",
      persistNote: "Vises til bilen kobles fra eller du starter noe nytt",
      primary: "Planlegg lading"
    },
    // Smart lading (UC16, HANDOFF §6b)
    smart: {
      pill: "Smart lading",
      status: "Lader i natt {start}–{end}",
      statusDay: "Lader {start}–{end}",
      sub: "Klar til {readyBy} {day} · +{kwh} kWh",
      legendPeak: "Kveldstopp",
      legendCheap: "Billig nettleie",
      legendCharge: "Lading",
      legendMarkers: "Nå · klar {readyBy}",
      cost: "ca. {cost} kr",
      saving: "sparer ca. {saving} kr og kveldstoppen",
      costEstimate: "anslag",
      primary: "Endre for i natt",
      primaryCharging: "Avbryt for i natt",
      charging: "Lader – ferdig ca. {time}"
    },
    // (app) UC15 / UC14 on Hjem
    guest: {
      statusWaiting: "Lånt ut – venter på gjesten",
      statusCharging: "Gjest lader · {kw} kW",
      statusConnected: "Gjest tilkoblet",
      sub: "Gjelder til bilen kobles fra. Planlegging er av så lenge.",
      primary: "Avslutt utlån",
      lentTo: "Lånt ut til {name}",
      ended: "Utlånet er avsluttet",
      endFailed: "Klarte ikke å avslutte utlånet",
    },
    chargingAutomatic: "Lader automatisk · {kw} kW",
    chargingAutomaticNoKw: "Lader automatisk",
    // D75 warning family (design/redesign/strings.nb.json home.incident, HANDOFF §6e).
    incident: {
      check: {
        charger: "Laderen:",
        chargerText: "har den strøm og nett?",
        cable: "Kabelen:",
        cableText: "sitter den godt i bilen og laderen?",
        zaptecApp: "Zaptec-appen:",
        zaptecAppText: "melder den en feil?"
      },
      retry: "Prøv igjen",
      retryStillOffline: "Laderen svarer fortsatt ikke",
      openMyOpel: "Åpne myOpel ↗",
      startFailed: {
        status: "Ladingen har stoppet",
        sub: "Stoppet {time} · trenger ca. {duration} til",
        title: "Laderen startet ikke ladingen igjen",
        body: "Jeg prøvde {count} ganger {from}–{to} og venter nå, så laderen ikke blir sperret."
      },
      offline: {
        status: "Laderen svarer ikke",
        sub: "Sist kontakt {time} · planen lader ikke",
        subManual: "Sist kontakt {time} · bilen lader ikke",
        title: "Ingen kontakt med laderen",
        body: "Laderen har ikke svart på {duration}. Jeg kan ikke starte eller stoppe den nå."
      },
      locked: {
        status: "Ladingen er stoppet",
        sub: "Laderen ble sperret {time}",
        title: "Laderen stoppet for mange ganger",
        body: "Koble bilen fra og til igjen, så kan den lade. Jeg prøver ikke på nytt av meg selv. Skjer det igjen: sjekk Zaptec-appen."
      },
      chargerWarning: {
        status: "Ladingen har stoppet",
        title: "Laderen melder en feil",
        body: "{warning}. Ladingen er stoppet."
      },
      declinedPlan: {
        status: "Bilen sluttet å lade",
        sub: "Kl. {time}, etter {duration} lading",
        title: "Trolig bilens ladegrense eller timer",
        body: "Planen blir ikke ferdig hvis bilen ikke tar strøm. Sjekk i myOpel."
      },
      chargeNow: {
        full: {
          status: "Bilen er trolig full",
          sub: "Sluttet å lade {time} · etter {duration}",
          hint: "Ladingen avsluttes av seg selv kl. {time} hvis bilen ikke tar mer strøm."
        },
        stopped: {
          status: "Bilen sluttet å lade",
          sub: "Kl. {time}, etter {duration} lading",
          title: "Trolig bilens ladegrense eller timer",
          body: "Sjekk i myOpel."
        },
        idle: {
          status: "Bilen tar en pause",
          sub: "Har ikke ladet siden {time} · {minutes} min",
          body: "Laderen er fortsatt klar. Bilen starter ofte igjen av seg selv, for eksempel etter batterivarming.",
          hint: "Etter 30 min uten lading viser jeg hva det kan skyldes."
        },
        never: {
          status: "Bilen har ikke begynt å lade",
          sub: "Startet {time} · 0 kWh på {minutes} min",
          title: "Sjekk kabelen og bilens timer",
          body: "Sitter kabelen godt? Har bilen en ladetimer på?"
        },
        primary: "Avslutt ladingen",
        hintOpen: "Bilen kan starte igjen selv. Laderen står klar til du avslutter eller kobler fra."
      },
      preheatBattery: {
        title: "Bilen har sluttet å trekke strøm",
        body: "Forvarmingen går nå på batteriet."
      }
    },
    lastErrorAutomationPaused: "Jeg har tatt pause – koble bilen fra og til igjen",
    noControl: {
      title: "Jeg styrer ikke laderen akkurat nå",
      body: "Laderen krever innlogging igjen, så planer og «Lad nå» virker ikke. Start lading med brikke eller i Zaptec-appen, eller slå av krav om autentisering i Zaptec Portal.",
      link: "Les mer i Innstillinger ›",
      status: "Tilkoblet – venter på innlogging",
      sub: "Ingen handlinger tilgjengelig her",
    },
    stats: { delivered: "Levert", time: "Tid", cost: "Kostnad" },
    recent: { title: "Siste hendelser", seeAll: "Se alle", empty: "Ingen hendelser ennå" },
    // (app)
    offline: "Laderen er frakoblet nettet",
    // Status lines when the estimate behind the design copy isn't available yet.
    plannedNoTime: "Planlagt",
    chargingPlanNoTime: "Lader etter plan",
    chargingManualNoKw: "Lader nå",
    // Lad nå is on, but the car isn't drawing power (full, or it declined).
    // noControl while unplugged: the banner explains; the status mustn't claim "Tilkoblet".
    noControlNoCar: "Ingen bil tilkoblet – laderen krever innlogging",
    planRowKwh: "Plan: {kwh} klar {readyBy}",
    lastErrorNoCar: "Burde ha startet, men ingen bil er koblet til",
    lastErrorStartFailed: "Laderen svarer ikke – koble bilen fra og til igjen",
    ringOf: "av {kwh}",
    noChargers: "Fant ingen ladere på Zaptec-kontoen.",
    suggestionDetail: "+{kwh} kWh · klar {time} i morgen",
    suggestionDetailPercent: "Til {percent} % (+{kwh} kWh) · klar {time} i morgen",
  },
  planSheet: {
    titleNew: "Planlegg lading",
    titleEdit: "Endre plan",
    close: "Lukk",
    batteryNow: "Batteri nå",
    batteryHint: "Målt av bilen {time} · dra hvis du vet bedre",
    // (app)
    batteryHintNoReading: "Ingen måling fra bilen · dra for å anslå",
    batteryHintEstimated: "Beregnet fra måling {time} · dra hvis du vet bedre",
    chargeTo: "Lad til",
    targets: [70, 80, 90, 100],
    readyBy: "Klar til",
    day: { today: "I dag", tomorrow: "I morgen", pick: "Velg dato" },
    times: ["06:30", "07:00", "07:30", "08:00"],
    otherTime: "Annet",
    summary: "Starter ca. {start} · klar {readyBy} {day}",
    basis: "Regner med {kw} kW fra tidligere ladinger og et batteri på {capacity} kWh.",
    noCar: "Starter når bilen kobles til",
    targetTooLow: "Målet må være høyere enn batteriet nå.",
    // (app) D29: lending and plans are mutually exclusive
    lentOut: "Laderen er lånt ut. Avslutt utlånet for å planlegge lading.",
    lentOutTitle: "Laderen er lånt ut",
    // (app) D55: a plan that's charging isn't edited
    inProgressTitle: "Planen lader nå",
    inProgress: "En plan som lader kan ikke endres. Avbryt den, og lag en ny plan.",
    inProgressError: "Planen lader nå. Avbryt den, og lag en ny plan.",
    lentOutEnd: "Avslutt utlån",
    // (app)
    pastTime: "Velg et tidspunkt fram i tid.",
    hour: "Time",
    minute: "Minutt",
    date: "Dato",
    summaryKwh: "+{kwh} kWh",
    startsNow: "Rekker ikke helt – starter med en gang · klar {readyBy} {day}",
    noCarSummary: "Starter når bilen kobles til · klar {readyBy} {day}",
    save: "Lagre plan",
    cancel: "Avbryt plan",
    cancelConfirm: "Avbryte planen?",
  },
  preheatSheet: {
    title: "Forvarm bilen",
    intro: "Bilen henter strøm fra laderen i stedet for batteriet mens kupeen varmes opp.",
    step1: "Strøm til bilen er på",
    step1Sub: "Startet {time} · {kw} kW",
    step2: "Start klima i myOpel",
    step2Sub: "Jeg kan ikke styre klimaanlegget selv.",
    openMyOpel: "Åpne myOpel",
    stop: "Stopp strøm",
    // D67: the car is already charging -- Forvarm rides along, nothing is cancelled
    step1Charging: "Strøm er på – lading pågår",
    // D67 under a plan / Smart lading: a hold keeps the power on (earlier of 60 min and readyBy)
    holdIntro: "Strømmen holdes på til {time}.",
    holdPastTarget: "Bilen kan lade forbi {target} % i mellomtiden",
    holdPastPlan: "Bilen kan lade mer enn planen i mellomtiden",
    holdCost: " – ca. {kwh} kWh / {kr} kr ekstra ved dagens pris.",
    holdKwh: " – ca. {kwh} kWh ekstra.",
    holdAfter: "Planen fortsetter som før etterpå.",
    holdConfirm: "Hold strømmen på",
    holdOn: "Strøm holdes på til {time}",
    holdDetail: "strøm holdes på til {time}",
    homeLine: "Forvarming – strøm holdes på til {time}",
    // D68: the car stopped drawing power -- the cabin heater runs on the battery
    onBattery: "Bilen har sluttet å trekke strøm – forvarmingen går nå på batteriet.",
    // (app) before the next refresh shows the session
    starting: "Starter…",
  },
  // (app) push action "Lad nå" opens this confirm sheet; a link alone never starts charging.
  chargeNowSheet: {
    title: "Lade nå?",
    body: "Bilen lader til du stopper eller kobler fra.",
    confirm: "Lad nå",
    cancel: "Ikke nå",
  },
  history: {
    title: "Historikk",
    tabs: { sessions: "Økter", plans: "Planer", activity: "Aktivitet" },
    groups: { thisWeek: "Denne uken", lastWeek: "Forrige uke" },
    tags: {
      plan: "Plan",
      manual: "Lad nå",
      preheat: "Forvarming",
      guest: "Gjest",
      automatic: "Automatisk",
      smart: "Smart",
      imported: "Zaptec",
    },
    // D70: sessions from before the app recorded its own
    importedDetail: "Importert fra Zaptec",
    carPrefix: "{car} · {detail}",
    groupTotal: "{kwh} kWh · {kr} kr",
    monthRow: "{count} økter · {kwh} kWh",
    monthRowOne: "1 økt · {kwh} kWh",
    rowDetail: "{duration} · {kr} kr",
    noSessions: "Ingen økter denne uken.",
    noSessionsLastWeek: "Ingen økter forrige uke.",
    emptySessions: "Ingen ladeøkter ennå.",
    emptyPlans: "Ingen tidligere planer.",
    emptyActivity: "Ingen hendelser ennå.",
    // (app) Planer and Aktivitet grouped like Økter (owner, 2026-11-12)
    plansCount: "{count} planer",
    plansCountOne: "1 plan",
    noPlans: "Ingen planer denne uken.",
    noPlansLastWeek: "Ingen planer forrige uke.",
    eventsCount: "{count} hendelser",
    eventsCountOne: "1 hendelse",
    noEvents: "Ingen hendelser denne uken.",
    noEventsLastWeek: "Ingen hendelser forrige uke.",
    planStatus: { completed: "Fullført", cancelled: "Avbrutt" },
    planReady: "Klar {readyBy}",
    planBy: "{name} · {target}",
    unknownKwh: "ikke målt",
    activityBy: "{name}",
  },
  insights: {
    title: "Innsikt",
    energySoFar: "Energi hittil",
    costSoFar: "Kostnad hittil",
    vsLastMonth: "{change} mot samme tid i {month}",
    avgPrice: "snitt {price} kr/kWh",
    perDay: "kWh per dag",
    perPerson: "Per person",
    guest: "Gjest",
    priceNote: "Pris: Norgespris. Sammenligning med spotpris kommer senere.",
    // (app) nettleie estimate (D30)
    priceNoteGrid: "Pris: Norgespris + nettleie (energiledd, dag/natt). Fastleddet er ikke med.",
    priceNoteNoGrid: "Pris: Norgespris. Nettleie er ikke lagt inn ennå.",
    costSplit: "strøm {energy} kr · nettleie {grid} kr",
    // (app)
    prevMonth: "Forrige måned",
    // (app) label before the Kjøring comparison line
    prevMonthShort: "Forrige måned",
    nextMonth: "Neste måned",
    noComparison: "Ingen lading i {month} å sammenligne med",
    personRow: "{kwh} kWh · {kr} kr",
    automatic: "Automatisk",
    smart: "Smart lading",
    // D70: Zaptec sessions from before the app -- no person to count them for
    imported: "Importert fra Zaptec (ingen person)",
    empty: "Ingen lading registrert denne måneden.",
    changePriceLink: "Om prisene ›",
    chartLabel: "Energi per dag i {month}",
    // Year view (HANDOFF §6d, design update 2026-11-13)
    periodMonth: "Måned",
    periodYear: "År",
    // (app) aria-label of the Måned | År control
    periodLabel: "Periode",
    year: {
      energy: "Energi i år",
      cost: "Kostnad i år",
      // (app) a past year: "i år" would mean this year (DECISIONS D76)
      energyIn: "Energi {year}",
      costIn: "Kostnad {year}",
      vsLastYear: "{change} mot {range} {year}",
      perMonth: "kWh per måned",
      perMonthHint: "Trykk for å se måneden",
      partialMonth: "{month} er ikke ferdig ennå (stiplet).",
      prevYear: "Forrige år",
      nextYear: "Neste år",
      drivenYear: "kjørt i år",
      // (app) a past year (D76)
      drivenIn: "kjørt i {year}",
      effPerMonth: "km/kWh per måned",
      effLowest: "Lavest {month} {value}",
      effHighest: "Høyest {month} {value}",
      effNote: "Kaldt vær gir høyere forbruk. Måneder med for lite data er utelatt fra kurven.",
      // (app) screen-reader labels
      chartLabel: "Energi per måned i {year}",
      barLabel: "{month}: {kwh} kWh",
      effChartLabel: "Kilometer per kWh per måned i {year}",
    },
    car: { chipNote: "Gjestelading telles separat" },
    drive: {
      title: "Kjøring",
      odometer: "km-stand {km} · målt {when}",
      driven: "kjørt i {month}",
      efficiency: "Effektivitet",
      efficiencyValue: "{value} km/kWh",
      consumption: "Forbruk",
      consumptionValue: "{value} kWh/mil",
      cost: "Kostnad",
      costValue: "ca. {value} kr/mil",
      previous: "{km} km · {eff} km/kWh · {cost} kr/mil",
      notEnough: "For lite data til å regne forbruk ennå",
      footnote: "Ut fra kilometerstand og batterinivå fra bilen (Smartcar). Kostnaden bruker snittprisen for lading hjemme.",
      // (app) design copy said "tatt med i forbruket" -- the rule leaves those pairs out (DECISIONS D58)
      awayCharges: "{count} lading et annet sted er holdt utenfor forbruket og kostnaden.",
      awayChargesPlural: "{count} ladinger andre steder er holdt utenfor forbruket og kostnaden.",
    },
  },
  settings: {
    title: "Innstillinger",
    notifications: {
      section: "Varsler",
      thisDevice: "På denne enheten",
      thisDeviceSub: "Bil koblet til, lading starter, lading ferdig",
      iosHint: "På iPhone må appen være lagt til på Hjem-skjermen for å få varsler.",
      // (app)
      unsupported: "Denne nettleseren støtter ikke varsler.",
      enabled: "Varsler slått på",
      disabled: "Varsler slått av",
      blocked: "Varsler er blokkert",
      blockedSub: "Tillat varsler for nettstedet i nettleserinnstillingene for å slå dem på.",
      notConfigured: "Varsler er ikke satt opp på denne installasjonen.",
      enableFailed: "Klarte ikke å slå på varsler på denne enheten.",
      disableFailed: "Klarte ikke å slå av varsler på denne enheten.",
      test: "Send testvarsel",
      testSent: "Testvarsel sendt",
      testFailed: "Klarte ikke å sende testvarsel",
      testNoDevice: "Ingen av enhetene dine har varsler slått på.",
    },
    price: {
      section: "Strømpris",
      model: "Prismodell",
      norgespris: "Norgespris",
      // (app)
      perKwh: "Pris per kWh",
      perKwhValue: "{price} kr/kWh",
      perKwhSub: "Inkl. mva. Nettleie er ikke med.",
      save: "Lagre",
      saved: "Strømprisen er lagret",
      invalid: "Skriv en pris mellom 0 og 20 kr/kWh.",
      // (app) nettleie estimate (D30)
      gridDay: "Nettleie dag",
      gridDaySub: "Hverdager 06–22",
      gridNight: "Nettleie natt og helg",
      gridNightSub: "22–06 og lørdag–søndag",
      gridNotSet: "Ikke lagt inn",
      gridHelp: "Energileddet fra nettselskapets prisliste, med avgifter og mva. La begge stå tomme for å regne uten nettleie.",
      // (app) where the numbers come from (Elvia tariffblad 1.0, 1 Jul 2026; regjeringen.no)
      sourceTitle: "Hvor kommer tallene fra?",
      sourceNorgespris: "Norgespris: 40 øre/kWh + 25 % mva = 50 øre/kWh (1. okt. 2025 – 31. des. 2026).",
      sourceElvia:
        "Nettleie: Elvias standard tariff for forbrukerkunder fra 1. juli 2026 – 46,40 øre/kWh hverdager 06–22 og 31,40 øre/kWh natt, helg og helligdager, inkl. Enova-avgift, elavgift og mva.",
      sourceFixed:
        "Fastleddet (fra 150 kr/mnd, etter de tre høyeste timene i måneden) avhenger ikke av kWh og er ikke med i kostnaden per lading.",
      sourceEstimate: "Kostnaden er et anslag: strømmen fordeles jevnt over ladetiden for å finne andelen dag og natt.",
      sourceLink: "Elvias nettleiepriser ↗",
      gridSaved: "Nettleie er lagret",
      gridInvalid: "Fyll inn begge prisene (0–20 kr/kWh), eller la begge stå tomme.",
    },
    // (app) the location name shown as the Hjem title
    location: {
      name: "Navn på stedet",
      fromZaptec: "Hentes fra Zaptec-kontoen – endres i Zaptec-appen",
    },
    charging: {
      section: "Lading",
      allowAutomatic: "Tillat automatisk lading",
      allowAutomaticSub: "Alle som kobler til får lade uten plan",
      lend: "Lån ut laderen",
      lendSub: "Gjest lader til bilen kobles fra",
      // (app)
      allowAutomaticWarning: "Alle som kobler til laderen kan da lade, også uten å være i husstanden.",
      allowAutomaticOn: "Automatisk lading slått på",
      allowAutomaticOff: "Automatisk lading slått av",
      lendAction: "Lån ut",
      lendActive: "Lånt ut nå – gjelder til bilen kobles fra",
      lendActiveNamed: "Lånt ut til {name} – til bilen kobles fra",
      allowAutomaticUntil: "På til {until}",
      lendEnd: "Avslutt",
      lendStarted: "Laderen er lånt ut",
      lendCancelsPlan: {
        title: "Låne ut laderen?",
        body: "Planen (klar {readyBy}) blir avbrutt. Planlegging er av til utlånet er slutt.",
        confirm: "Avbryt plan og lån ut",
      },
      saveFailed: "Klarte ikke å lagre",
    },
    system: {
      section: "System",
      scheduler: "Planlegging",
      schedulerActive: "Aktiv · sjekket {time}",
      learnedRate: "Lært ladeeffekt",
      version: "Versjon",
      debug: "Feilsøkingsmodus",
      // (app)
      debugSub: "Viser byggnummer og lar deg forhåndsvise tilstander på Hjem",
      mock: "Mock-kontroll",
    },
    account: { section: "Konto", logout: "Logg ut" },
  },
  picker: {
    title: "Ladere og biler",
    chargers: "Ladere",
    cars: "Biler",
    addCar: "+ Legg til bil",
    defaultCar: "Standard på {location}",
    hiddenNote: "Med én lader og én bil vises ikke denne velgeren – adressen står bare som tittel på Hjem.",
  },
  activity: {
    plugged_in: "Bil koblet til",
    unplugged: "Bil koblet fra",
    charging_started: "Lading startet",
    charging_stopped: "Lading stoppet",
    manual_start: "Startet manuelt",
    manual_stop: "Stoppet manuelt",
    preheat_started: "Forvarming startet",
    preheat_during_charge: "Forvarm (under lading)",
    plan_created: "Plan laget",
    plan_cancelled: "Plan avbrutt",
    plan_restored: "Plan gjenopprettet",
    plan_charging_started: "Lading startet etter plan",
    plan_completed: "Bilen er klar",
    stopped_unplanned: "Automatisk lading stoppet (ingen plan)",
    guest_started: "Laderen lånt ut til gjest",
    guest_ended: "Gjestelading avsluttet",
    automatic_allowed: "Automatisk lading slått på",
    automatic_disallowed: "Automatisk lading slått av",
    automatic_completed: "Automatisk lading nådde målet",
    smart_planned: "Smart lading planlagt",
    smart_cancelled: "Smart lading avbrutt for denne ladingen",
    // (app) Innstillinger → "Når bilen kobles til"; detail = the new choice
    on_plugin_mode_changed: "Når bilen kobles til: endret",
    // D65 / D75 "locked": the loop guard tripped
    automation_paused: "Laderen stoppet for mange ganger",
    // D75 incidents; {placeholders} are filled from the event's detail (src/lib/ui/activity.ts)
    car_stopped_full: "Bilen sluttet å lade – trolig full",
    car_stopped: "Bilen sluttet å lade – {percent} %",
    car_never_started: "Bilen begynte ikke å lade",
    start_failed: "Laderen startet ikke – {count} forsøk",
    charger_offline: "Laderen mistet kontakt",
    charger_back: "Laderen er tilbake",
    retry: "Prøvde igjen ({name})",
    unplugged_before_target: "Koblet fra ved {percent} % – planen ble ikke ferdig",
    charger_warning: "Laderen meldte feil: {warning}",
  },
  // Web Push copy, from design/redesign/notifications.nb.json.
  notifications: {
    pluggedIn: {
      title: "Bilen er koblet til",
      body: "Batteri {percent} % (målt {time}). Trykk for å planlegge lading.",
      bodyNoBattery: "Trykk for å planlegge lading.",
      plan: "Planlegg",
      chargeNow: "Lad nå",
    },
    planWaiting: { title: "Bilen er koblet til", body: "Planen er klar – lading starter ca. {startTime}." },
    planStarted: { title: "Lading startet", body: "Lader til {targetPercent} %, ferdig ca. {finishTime}." },
    // (app) variants for plans made without a battery reading (no %)
    planStartedKwh: "Lader {kwh} kWh, ferdig ca. {finishTime}.",
    // D75 incidents (notifications.nb.json charge_now_*, car_declined_plan, fault_*): one push per incident
    carFull: { title: "Bilen er trolig full", body: "Sluttet å lade ved {percent} % · {kwh} kWh." },
    carStopped: { title: "Bilen sluttet å lade", body: "Stoppet ved {percent} %. Sjekk ladegrensen eller timeren i bilen." },
    carNeverStarted: { title: "Bilen lader ikke", body: "Ingen strøm etter {minutes} min. Sjekk kabelen og bilens timer." },
    carDeclinedPlan: { title: "Bilen sluttet å lade", body: "Stoppet ved {percent} %, før målet. Sjekk bilens ladegrense eller timer." },
    faultStartFailed: { title: "Ladingen stoppet", body: "Laderen startet ikke kl. {time}. Sjekk laderen, eller prøv igjen i appen." },
    faultOffline: { title: "Laderen svarer ikke", body: "Ingen kontakt siden {time}. Bilen lader ikke." },
    faultLoopGuard: { title: "Laderen stoppet for mange ganger", body: "Koble bilen fra og til igjen for å lade." },
    faultWarning: { title: "Laderen melder en feil", body: "{warning}. Ladingen er stoppet." },
    // (app) D68: the car stopped drawing power during Forvarm
    preheatOnBattery: {
      title: "Forvarming bruker batteriet",
      body: "Bilen sluttet å trekke strøm fra laderen kl. {time}.",
    },
    planCompleted: { title: "Bilen er klar", body: "Ladet til ca. {targetPercent} % · {kwh} kWh · ca. {cost} kr." },
    planCompletedKwh: "Ladet {kwh} kWh · ca. {cost} kr.",
    planLate: {
      title: "Rekker ikke helt",
      body: "Bilen blir ca. {expectedPercent} % klar {readyBy}. Jeg lader videre til {targetPercent} %.",
    },
    planLateKwh: "Bilen blir ikke helt ferdig {readyBy}. Jeg lader videre til målet.",
    planWaitingForCar: { title: "Planen venter på bilen", body: "Koble til innen {latestStart} for å være klar {readyBy}." },
    smartPlanned: {
      title: "Smart lading i natt",
      body: "Lader til {targetPercent} % {start}–{end} · ca. {cost} kr.",
      chargeNowInstead: "Lad nå i stedet",
    },
    // (app) Innstillinger "Send testvarsel"
    test: { title: "Testvarsel", body: "Varsler virker på denne enheten." },
  },
  // (app) the "did we estimate well" note on plan_completed in Aktivitet
  accuracy: {
    before: "Ferdig {duration} før klar-tid",
    after: "Ferdig {duration} etter klar-tid",
    asEstimated: " (som beregnet)",
    slower: " (tok {duration} lenger enn beregnet)",
    faster: " ({duration} raskere enn beregnet)",
    paused: " – inkl. pause",
  },
  // Innstillinger → "Når bilen kobles til" (HANDOFF §6b); expired/untilLabel/saved are (app)
  onPlugin: {
    title: "Når bilen kobles til",
    intro: "Gjelder når det ikke finnes en plan. En plan, lading du starter selv eller forvarming overstyrer for den ladingen.",
    settingsRow: "Når bilen kobles til",
    settingsRowSmart: "Smart lading · {percent} % innen {time}",
    wait: {
      title: "Vent på plan",
      sub: "Lader ikke før noen planlegger eller trykker Lad nå"
    },
    now: {
      title: "Lad med en gang",
      sub: "Lader til fullt med en gang («Automatisk»)"
    },
    smart: {
      title: "Smart lading",
      sub: "Billigst mulig til {percent} % innen klar-tid"
    },
    target: "Lad til",
    readyWeekday: "Klar til, hverdager",
    readyWeekend: "Klar til, helg",
    cheapest: "Billigst: natt 22–06 og helg · {price} øre/kWh",
    dearest: "Dyrest: hverdager 06–22 · {price} øre/kWh",
    priceNote: "Norgespris + nettleie Elvia. Unngår alltid kveldstoppen 16–21.",
    save: "Lagre",
    expired: "utløpt",
    // (app) both automatic choices charge to the same target % (owner decision D51)
    nowSubTarget: "Lader til {percent} % med en gang («Automatisk»)",
    settingsRowNow: "Lad med en gang · {percent} %",
    targetNote: "Gjelder bilen som er registrert. Uten måling fra bilen lades den til den stopper selv.",
    untilLabel: "På til {until}",
    saved: "Lagret",
    modeTitle: "{mode}"
  },
  // Dialogs and toasts (strings.nb.json dialogs / toasts; HANDOFF §3b)
  dialogs: {
    // (app)
    stopChargingNoPercent: "Bilen har fått {kwh} kWh. Den lader ikke mer før du starter igjen.",
    lendCancelsPlan: "Planen (klar {readyBy}) blir avbrutt.",
    cancelPlan: {
      title: "Avbryte planen?",
      body: "{percent} % klar {readyBy} {day} slettes. Bilen lader ikke før du lager en ny plan eller trykker Lad nå.",
      safe: "Behold",
      action: "Avbryt plan"
    },
    stopCharging: {
      title: "Stoppe ladingen?",
      body: "Bilen har fått {kwh} kWh og er på ca. {percent} %. Den lader ikke mer før du starter igjen.",
      safe: "Fortsett",
      action: "Stopp lading"
    },
    stopPreheat: {
      title: "Stoppe forvarmingen?",
      body: "Bilen bruker batteriet hvis klimaanlegget fortsatt står på.",
      safe: "Fortsett",
      action: "Stopp forvarming"
    },
    allowAutomatic: {
      title: "Tillate automatisk lading?",
      body: "Alle som kobler til laderen på {location} får lade uten plan. Strømmen telles som «Automatisk».",
      durationLabel: "Hvor lenge?",
      untilTomorrow: "Til i morgen kl. 08:00",
      untilOff: "Til jeg slår det av",
      safe: "Avbryt",
      action: "Tillat"
    },
    lendCharger: {
      title: "Låne ut laderen?",
      body: "En gjest kan lade til bilen kobles fra. Strømmen telles som «Gjest», og {car}-planer venter så lenge.",
      nameLabel: "Hvem låner?",
      nameOptional: "(valgfritt)",
      namePlaceholder: "F.eks. nabo i nr. 3",
      safe: "Avbryt",
      action: "Lån ut"
    },
    chargerError: {
      title: "Fikk ikke kontakt med laderen",
      body: "Laderen svarte ikke på «{command}». Planene dine er ikke endret.",
      safe: "Lukk",
      action: "Prøv igjen"
    },
    logout: {
      title: "Logge ut?",
      body: "Varsler på denne enheten slås av til du logger inn igjen.",
      safe: "Avbryt",
      action: "Logg ut"
    }
  },
  toasts: {
    // (app)
    undoExpired: "For sent å angre – lag en ny plan.",
    planRestored: { title: "Planen er tilbake" },
    automaticOff: { title: "Automatisk lading av" },
    automaticOnIndefinitely: "Til du slår det av",
    loggedOut: "Logget ut",
    planSaved: {
      title: "Plan lagret",
      body: "Starter ca. {start} · klar {readyBy}"
    },
    planCancelled: {
      title: "Plan avbrutt",
      body: "{percent} % klar {readyBy}",
      undo: "Angre"
    },
    planSaveFailed: {
      title: "Kunne ikke lagre planen",
      overlap: "Det finnes allerede en plan for denne laderen."
    },
    chargingStarted: {
      title: "Lading startet"
    },
    chargingStopped: {
      title: "Lading stoppet"
    },
    automaticOn: {
      title: "Automatisk lading på",
      body: "Til {until}"
    },
    guestOn: {
      title: "Laderen er lånt ut",
      body: "Til bilen kobles fra"
    }
  },
  // (app) the app's confirm dialog (src/components/ConfirmDialog.tsx)
  confirm: { cancel: "Ikke nå" },
  // (app) toasts and pending labels for the Hjem actions
  // D73: charger health from Zaptec's Warnings (804) / IsOnline / signal (809).
  health: {
    ok: "Tilkoblet · ingen feil",
    offline: "Ingen kontakt med laderen",
    signal: "signal {dbm} dBm",
    code: "kode {code}",
    warningHome: "Laderen melder en feil: {what}",
    warningDetail: "Feil: {what} ({codes})",
    label: "Laderen",
  },
  // D71: a command from a screen that may be out of date.
  freshness: {
    alreadyCharging: "Lader allerede ({by})",
    alreadyPreheating: "Forvarmer allerede ({by})",
    alreadyStopped: "Allerede stoppet",
    startedBy: "startet av {name} {time}",
    startedAt: "startet {time}",
    changed: "Statusen har endret seg – sjekk igjen",
    updating: "Oppdaterer…",
    waitingStart: "Venter på at laderen starter…",
    waitingStop: "Venter på at laderen stopper…",
  },
  actions: {
    working: "Jobber…",
    chargeStarted: "Lading startet",
    chargeStartFailed: "Klarte ikke å starte lading",
    chargeStopped: "Lading stoppet",
    chargeStopFailed: "Klarte ikke å stoppe lading",
    preheatStarted: "Strøm på – start klima i myOpel",
    preheatFailed: "Klarte ikke å starte forvarming",
    planCancelled: "Planen er avbrutt",
    planCancelFailed: "Klarte ikke å avbryte planen",
    planCreated: "Lading planlagt",
    planCreateFailed: "Klarte ikke å planlegge ladingen",
    planInTheWay: "Laderen har en plan. Avbryt planen først, eller bekreft at den skal avbrytes.",
    chargeNowCancelsPlan: {
      title: "Lade nå i stedet for planen?",
      body: "Planen (klar {readyBy}) blir avbrutt, og bilen lader til du stopper.",
      confirm: "Avbryt plan og lad",
    },
    preheatCancelsPlan: {
      title: "Forvarme i stedet for planen?",
      body: "Planen (klar {readyBy}) blir avbrutt – ellers ville den stoppet strømmen igjen.",
      confirm: "Avbryt plan og forvarm",
    },
    sheetCancelsPlan: "Dette avbryter planen (klar {readyBy}).",
    planCreatedTight: "Det er ikke nok tid til å bli ferdig i tide – ladingen starter med en gang.",
    previewNote: "Viser et feilsøkingsscenario – ekte knapper er skjult så et trykk ikke sender en kommando.",
  },
  // (app)
  login: {
    subtitle: "Logg inn for å fortsette.",
    email: "E-post",
    password: "Passord",
    submit: "Logg inn",
    submitting: "Logger inn…",
  },
  // (app)
  debug: {
    build: "bygg {sha} · {env}",
    real: "Ekte data",
    exit: "Avslutt feilsøking",
    preview: "Forhåndsvisning: {label}",
  },
} as const;

export type ActivityKey = keyof typeof nb.activity;

/** Fills `{name}`-style placeholders. Unknown placeholders are left visible so they get noticed. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

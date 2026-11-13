# Design brief: Lad nå is on, but the car isn't drawing power

For Claude design. Written 2026-11-13 from the code as it is now; nothing here is built yet. The decisions log (`DECISIONS.md`, D68/D69) and `HANDOVER.md` hold the background.

## The problem

Someone taps **Lad nå**, the car charges, and then the car stops taking power while Lad nå is still on. Today Hjem only swaps the status line under the battery ring:

> Lader nå · 7,1 kW → **Lad nå er på – bilen lader ikke**

There is no amber line, no explanation, no next step and no push. The Stopp lading button stays. The Lad nå session stays open until someone presses Stopp or unplugs the car. The owner tried it and found it too quiet: it isn't clear whether something is wrong or whether to do anything.

Forvarm already handles the same situation (D68). If the car stops drawing during a Forvarm, Hjem shows the amber line "Bilen har sluttet å trekke strøm – forvarmingen går nå på batteriet.", the Forvarm sheet's step 1 is no longer done, and one push goes out ("Forvarming bruker batteriet"). Lad nå should feel consistent with that, but the stakes are lower: nothing drains the battery, the car just isn't gaining charge.

## Addendum: the owner's rule (2026-11-13, added after design started)

This widens the brief from Lad nå to **every kind of charging**. In the owner's words: show a warning and notify whenever someone has asked for any type of charging and the charging then stops for any reason other than the user stopping it or the plan completing. It must be visible when something is not as the user asked. A real error should look more serious than the car just saying "no thanks" to more power.

**What counts as "asked for charging":** Lad nå, Forvarm, a charging plan inside its charging window, Smart lading inside its window, and an automatic session ("Lad med en gang", UC14).

**What doesn't need a warning (expected endings):**
- Someone pressed Stopp lading, cancelled the plan or tapped "Avbryt for i natt".
- The plan or Smart lading reached its target or ended its window.
- A Forvarm ended (Stopp, its time ran out, or its hold ended).
- The car was unplugged. *Assumption:* someone pulled the cable on purpose. The design can challenge this.

**Two levels, both shown on Hjem and both with one push:**

| Level | Examples | Tone |
| --- | --- | --- |
| **Fault**: the charger, Zaptec or the app failed | This morning's stop/start loop (D64/D65, 01:39–02:19); a start the charger won't carry out (D64's three tries); the charger offline or reporting a warning (D73) while charging was wanted; the app losing control of the charger | Serious: clearly an error, says what the app did and what to do |
| **Car declined**: the car itself stopped taking power | Full or at the car's own limit; the car's own timer; idling at 0 A; Forvarm running on the battery (D68, today's amber line) | Calmer: "the car stopped taking power", with the likely reason (case table below) |

The case table below then describes the "car declined" level in detail; case 1 (probably full) may still be the mildest of all.

**Already built, to fold into the same pattern:** the Forvarm battery warning (D68, amber line and push), the loop-guard push (D65), the "won't start" push (D64) and the charger health line (D73). The design should make these one family, with the same placement on Hjem, two severities and consistent push wording, rather than adding a fifth separate style.

**Extra deliverables for the addendum:**
- The fault level on Hjem, at least for: plan charging that stopped (fault), charger offline while charging was wanted, and the loop guard.
- One push per level: title and body, in the shape of `notifications.nb.json`.
- The rule for clearing: the warning disappears when charging picks up again, the user acts (Stopp, unplug), or the plan's window ends. At most one push per incident.

## What the app knows (and doesn't)

The app can't know *why* the car stopped. Zaptec only sees that it stopped asking for power. The clues it has:

| Clue | Where it comes from | What it suggests |
| --- | --- | --- |
| Battery % and when it was read | Smartcar, every few minutes to an hour; can be stale | ≥ about 95 %: probably full, or at the car's own charge limit |
| Charger mode 5 ("stopped") | Zaptec /state | The car said "stop": full, at its limit, or its own timer/schedule took over |
| Mode 3 at about 0 A on every phase | Zaptec phase currents (D69) | The car is idling but still authorised: often a pause by the car, may start again by itself |
| How long since it last drew power | Ticks every minute | Under 2 min: may be a short pause; Forvarm waits 2 min before calling it "not drawing" (D68) |
| Energy delivered in this Lad nå | The session row | 0 kWh from the start means it never really charged, which is different from stopping after a while |

The app does **not** know the car's own charge limit, its timer settings, or whether the cable is fully in. Smartcar gives no charge limit for this car.

## Cases to design for

1. **Probably full:** the car stopped and the battery is ≥ about 95 % (or at the last plan's target).
2. **Stopped below full:** the car said stop at, say, 70 %. Likely the car's own charge limit or its timer.
3. **Idling (mode 3, 0 A):** the car still holds the session but isn't drawing. It may resume by itself.
4. **Never started drawing:** Lad nå was tapped, but no energy has come in after a couple of minutes.
5. **Draws again:** any of the above, then the car picks up power again. Back to the normal "Lader nå · X kW".

## Questions for the design

1. **Hjem copy:** what the status line and, if used, an amber line say in each case. Give a likely reason and what to do (for example "Bilen er trolig full" or "Sjekk ladegrensen eller ladetimeren i bilen"), without pretending to know.
2. **Amber or calm:** case 1 is good news and probably shouldn't be amber. Which cases are a warning?
3. **The button:** does Stopp lading stay the main action? Or should the card offer to end Lad nå ("Avslutt Lad nå") once the car is full?
4. **Push:** *decided by the owner (see the addendum):* one push per incident, for both levels. Manual start and stop still don't push. What's left for the design is the wording, and whether case 1 (probably full) is worded as good news.
5. **Ending by itself:** should Lad nå close itself after a while when the car is full (for example after 30 min in case 1)? Or stay open until unplug in case the car wants more later (battery heating, a top-up)? Closing it affects Historikk (the session's end time) but not the charger.
6. **Historikk / Siste hendelser:** does "Bilen sluttet å lade" deserve an activity line, as Forvarm's battery case gets?

## Fixed limits

- **No automatic restart:** the app never re-sends a start command when the car stops by itself. A full car ignores it, and repeated commands count against Zaptec's fair-use limit (same rule as D68).
- **Timing:** Hjem refreshes once a minute in the real app. Today the status line follows the charger's mode, so it changes at the next refresh. Forvarm's "not drawing" check waits 2 min of no power (or acts at once on mode 5) so it doesn't react to short pauses; a new Lad nå warning would use the same rule.
- **Words and tokens:** Norwegian copy, matching the tone in `strings.nb.json`. Use the existing tokens (`theme.css`); amber is the warning colour. Light and dark.
- **Two phones:** the state must read the same on both phones, so no local-only dismissals.

## What to deliver

- Hjem hero card for cases 1–4, in light and dark (case 5 is the existing "Lader nå" card).
- Copy for each: status line, optional amber line, button label(s).
- If a push is proposed: title and body, and which case triggers it, in the shape of `notifications.nb.json`.
- A short note on questions 3, 5 and 6, so the implementation can follow without guessing.

## Seeing it today (mock mode)

`npm run dev:mock`, then open http://localhost:3100. Open the panel (Kontrollpanel) in another tab or window.

1. In the panel, pick the scenario **Tilkoblet – ingen plan**.
2. On Hjem, press **Lad nå**.
3. In the panel, press **Bilen slutter å trekke strøm** (mode 5) or **Bilen trekker 0 A (modus 3)** (idling). **Bilen trekker strøm igjen** is case 5.
4. Use the battery slider in the panel and **Bilen rapporterer** to try a full vs. a half-full battery.

Hjem then shows "Lad nå er på – bilen lader ikke" within a few seconds.

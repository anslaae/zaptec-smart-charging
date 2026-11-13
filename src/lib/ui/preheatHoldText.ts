import { formatNumber, formatTime } from "@/lib/datetime";
import { fill, nb } from "@/lib/i18n/nb";

const t = nb.preheatSheet;

/**
 * The Forvarm sheet's line before a hold (D67): "Strømmen holdes på til 07:30.
 * Bilen kan lade forbi 80 % i mellomtiden – ca. 3 kWh / 4 kr ekstra ved
 * dagens pris." Only kWh when no price is set.
 */
export function preheatHoldText(input: {
  untilIso: string;
  targetPercent: number | null;
  estimate: { kwh: number; nok: number | null };
}): string {
  const { untilIso, targetPercent, estimate } = input;
  const kwh = formatNumber(estimate.kwh, estimate.kwh < 10 ? 1 : 0);
  const more = targetPercent != null ? fill(t.holdPastTarget, { target: String(targetPercent) }) : t.holdPastPlan;
  const extra =
    estimate.nok != null ? fill(t.holdCost, { kwh, kr: String(estimate.nok) }) : fill(t.holdKwh, { kwh });
  return `${fill(t.holdIntro, { time: formatTime(untilIso) })} ${more}${extra}`;
}

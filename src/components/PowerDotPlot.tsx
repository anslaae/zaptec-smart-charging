import { formatNumber } from "@/lib/datetime";
import { powerSpread } from "@/lib/ui/carCharger";
import { fill, nb } from "@/lib/i18n/nb";

// Innstillinger → Lader (HANDOFF §6g): the realised kW of the plans behind
// the learned rate, one dot each, on a band from the lowest to the highest
// with the median marked. Presentational.

const W = 300;
const H = 44;
const PAD = 10;

export function PowerDotPlot({ values }: { values: number[] }) {
  const spread = powerSpread(values);
  if (!spread) return null;
  const pad = Math.max(0.3, (spread.max - spread.min) * 0.15);
  const lo = spread.min - pad;
  const hi = spread.max + pad;
  const x = (kw: number) => PAD + ((kw - lo) / (hi - lo)) * (W - 2 * PAD);
  const pct = (kw: number) => `${((x(kw) / W) * 100).toFixed(2)}%`;
  const mid = H / 2;
  const t = nb.settings.charger;

  return (
    <figure className="mt-3" data-testid="power-plot" data-count={values.length}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-11 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={fill(t.plotLabel, {
          min: formatNumber(spread.min, 1),
          max: formatNumber(spread.max, 1),
          kw: formatNumber(spread.median, 1),
        })}
      >
        <line x1={PAD} x2={W - PAD} y1={mid} y2={mid} stroke="var(--track)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <rect
          x={x(spread.min) - 6}
          width={Math.max(12, x(spread.max) - x(spread.min) + 12)}
          y={mid - 12}
          height={24}
          rx={12}
          fill="var(--accent-tint)"
          stroke="var(--accent-tint-border)"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1={x(spread.median)}
          x2={x(spread.median)}
          y1={2}
          y2={H - 2}
          stroke="var(--text)"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          data-median
        />
      </svg>
      {/* Dots as HTML so they stay round on a stretched SVG; alternate rows keep equal values apart. */}
      <div className="relative -mt-11 h-11" aria-hidden>
        {values.map((kw, i) => (
          <span
            key={i}
            data-dot
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-surface bg-accent"
            style={{ left: pct(kw), top: `${50 + (i % 2 ? 14 : -14)}%` }}
          />
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between gap-2 text-[11px] text-muted tabular-nums">
        <span>{formatNumber(spread.min, 1)} kW</span>
        <span className="font-semibold text-text">{fill(t.estimateRange, { kw: formatNumber(spread.median, 1) })}</span>
        <span>{formatNumber(spread.max, 1)} kW</span>
      </figcaption>
    </figure>
  );
}

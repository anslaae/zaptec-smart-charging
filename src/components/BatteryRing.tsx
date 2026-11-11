// The Hjem battery ring (188 px, 12 px stroke): arc = battery now, tick =
// plan target. Purely presentational -- the numbers come from
// src/lib/ui/battery.ts.

import { formatNumber } from "@/lib/datetime";

const SIZE = 188;
const STROKE = 12;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SWEEP = 22;

export type RingMode =
  | { kind: "percent"; percent: number; targetPercent: number | null; approx: boolean; caption: string | null }
  | { kind: "kwh"; deliveredKwh: number; targetKwh: number; caption: string }
  // Unplugged: the last reading from the car, muted (it can be old), if known.
  | { kind: "noCar"; caption: string | null; percent?: number | null }
  | { kind: "preheat"; percent: number | null; caption: string | null }
  | { kind: "empty" };

function PlugIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-10 w-10" aria-hidden="true">
      <path d="M9 2v5M15 2v5" />
      <path d="M6 7h12v3a6 6 0 0 1-12 0V7Z" />
      <path d="M12 16v6" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-12 w-12" aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function tickPosition(percent: number) {
  // 0 % at the top, clockwise.
  const angle = (percent / 100) * 2 * Math.PI - Math.PI / 2;
  const inner = RADIUS - STROKE / 2 - 3;
  const outer = RADIUS + STROKE / 2 + 3;
  const c = SIZE / 2;
  return {
    x1: c + inner * Math.cos(angle),
    y1: c + inner * Math.sin(angle),
    x2: c + outer * Math.cos(angle),
    y2: c + outer * Math.sin(angle),
  };
}

const formatPercent = (value: number) => `${Math.round(value)} %`;

/**
 * charging: a light highlight sweeps along the filled arc (use-case doc,
 * "animated sweep while charging"); off under prefers-reduced-motion.
 */
/** Small round badge on the ring (HANDOFF §3): "unplugged" in noCar, a lime check when a plan reached its target. */
export type RingBadge = "unplugged" | "check";

function Badge({ kind }: { kind: RingBadge }) {
  return (
    <span
      aria-hidden
      className={`absolute right-3 bottom-3 flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-surface ${
        kind === "check" ? "bg-accent text-on-accent" : "bg-surface-2 text-muted"
      }`}
    >
      {kind === "check" ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 12 5 5 9-10" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 2v5M15 2v5M6 7h12v3a6 6 0 0 1-12 0V7ZM12 16v6" />
          <path d="M3 3l18 18" />
        </svg>
      )}
    </span>
  );
}

export function BatteryRing({
  mode,
  label,
  charging = false,
  badge,
}: {
  mode: RingMode;
  label: string;
  charging?: boolean;
  badge?: RingBadge;
}) {
  const fraction =
    mode.kind === "percent"
      ? mode.percent / 100
      : mode.kind === "kwh"
        ? Math.min(1, mode.targetKwh > 0 ? mode.deliveredKwh / mode.targetKwh : 0)
        : (mode.kind === "preheat" || mode.kind === "noCar") && mode.percent != null
          ? mode.percent / 100
          : 0;
  const tick = mode.kind === "percent" && mode.targetPercent != null ? tickPosition(mode.targetPercent) : null;
  const arcColor =
    mode.kind === "preheat" ? "var(--amber)" : mode.kind === "noCar" ? "var(--ring-muted)" : "var(--accent)";

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }} role="img" aria-label={label}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--track)"
          strokeWidth={STROKE}
          strokeDasharray={mode.kind === "noCar" ? "6 8" : undefined}
        />
        {fraction > 0 && (
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={arcColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * fraction} ${CIRCUMFERENCE}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        )}
        {charging && fraction > 0.06 && (
          <circle
            className="ring-sweep"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="white"
            strokeOpacity={0.45}
            strokeWidth={STROKE - 4}
            strokeLinecap="round"
            strokeDasharray={`${SWEEP} ${CIRCUMFERENCE}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{ ["--sweep-distance" as string]: `${-(CIRCUMFERENCE * fraction - SWEEP)}px` }}
          />
        )}
        {tick && <line {...tick} stroke="var(--text)" strokeWidth={3} strokeLinecap="round" />}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        {mode.kind === "percent" && (
          <>
            <span className="text-[44px] font-bold leading-none tracking-[-0.02em]">
              {mode.approx && <span className="mr-1 align-top text-base font-semibold text-muted">ca.</span>}
              {formatPercent(mode.percent)}
            </span>
            {mode.caption && <span className="mt-1 text-xs text-muted">{mode.caption}</span>}
          </>
        )}
        {mode.kind === "kwh" && (
          <>
            <span className="text-[32px] font-bold leading-none tracking-[-0.02em]">
              {formatNumber(mode.deliveredKwh, 1)}
            </span>
            <span className="mt-1 text-xs text-muted">{mode.caption}</span>
          </>
        )}
        {mode.kind === "noCar" && mode.percent != null && (
          <>
            <span className="text-[40px] font-bold leading-none tracking-[-0.02em] text-text-2">
              {formatPercent(mode.percent)}
            </span>
            {mode.caption && <span className="mt-1 text-xs text-muted">{mode.caption}</span>}
          </>
        )}
        {mode.kind === "noCar" && mode.percent == null && (
          <>
            <span className="text-muted">
              <PlugIcon />
            </span>
            {mode.caption && <span className="mt-1 text-xs text-muted">{mode.caption}</span>}
          </>
        )}
        {mode.kind === "preheat" && (
          <>
            <span className="text-amber">
              <SunIcon />
            </span>
            {mode.caption && <span className="mt-1 text-xs text-muted">{mode.caption}</span>}
          </>
        )}
        {mode.kind === "empty" && <span className="text-[44px] font-bold leading-none text-muted">–</span>}
      </div>
      {badge && <Badge kind={badge} />}
    </div>
  );
}

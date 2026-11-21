import { PendingLink } from "@/components/Pending";
import { nb } from "@/lib/i18n/nb";

// Innstillinger's detail pages (HANDOFF §6g: Bil and Lader): a back link,
// sections with the same uppercase heading and card as Innstillinger, and
// read-only rows. Presentational.

export function DetailHeader({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-1">
      <PendingLink href="/settings" hint="inline" className="-ml-1 inline-flex min-h-11 w-fit items-center gap-1 px-1 text-[15px] font-semibold text-accent">
        <span aria-hidden>‹</span> {nb.settings.car.back}
      </PendingLink>
      <h1 className="text-[28px] leading-tight font-bold">{title}</h1>
    </div>
  );
}

export function DetailSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      {title && <h2 className="px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-muted">{title}</h2>}
      <div className="flex flex-col divide-y divide-divider rounded-[var(--radius-card)] border border-border bg-surface px-4">
        {children}
      </div>
    </section>
  );
}

export function DetailRow({
  label,
  value,
  sub,
  dot,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string | null;
  /** A status dot before the value: "ok" (accent) or "off" (muted). */
  dot?: "ok" | "off";
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 py-3">
      <span className="text-[15px]">{label}</span>
      <span className="min-w-0 text-right">
        <span className="flex items-center justify-end gap-1.5 text-[15px] font-semibold tabular-nums">
          {dot && <span aria-hidden className={`h-2 w-2 rounded-full ${dot === "ok" ? "bg-accent" : "bg-ring-muted"}`} />}
          {value}
        </span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
    </div>
  );
}

/** A row in Innstillinger that opens a detail page. */
export function LinkRow({ href, title, sub }: { href: string; title: string; sub: string }) {
  return (
    <PendingLink href={href} className="flex min-h-14 items-center justify-between gap-3 py-2">
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block text-sm text-muted">{sub}</span>
      </span>
      <span aria-hidden className="shrink-0 text-lg text-muted">
        ›
      </span>
    </PendingLink>
  );
}

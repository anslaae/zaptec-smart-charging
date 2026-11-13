"use client";

import { MyOpelLink } from "@/components/MyOpelLink";
import { ActionButton } from "@/components/ActionButton";
import { retryIncident } from "@/lib/incidents/actions";
import { nb } from "@/lib/i18n/nb";
import type { IncidentCardView } from "@/lib/ui/incidentView";

// D75 (HANDOFF §6e): the one warning card under the battery ring. Fault =
// danger tone (octagon), car declined = amber (triangle), calm = a neutral
// info card. Its actions are always outline buttons; the filled button stays
// the state's own action.

const TONE: Record<IncidentCardView["tone"], { box: string; title: string }> = {
  fault: { box: "border-danger-border bg-danger-tint", title: "text-danger" },
  declined: { box: "border-amber-border bg-amber-bg", title: "text-amber" },
  calm: { box: "border-border bg-surface-2", title: "text-text" },
};

const outline =
  "flex h-11 items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface px-4 text-[15px] font-semibold text-text";

function Icon({ tone }: { tone: IncidentCardView["tone"] }) {
  if (tone === "fault") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-danger" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M8.2 2.5h7.6l5.7 5.7v7.6l-5.7 5.7H8.2l-5.7-5.7V8.2z" />
        <path d="M12 7.5v5.5M12 16.5v.01" />
      </svg>
    );
  }
  if (tone === "declined") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-amber" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
        <path d="M12 3 2 20.5h20z" />
        <path d="M12 9.5v5M12 17.5v.01" />
      </svg>
    );
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6M12 7.5v.01" />
    </svg>
  );
}

const CHECKS = [
  [nb.home.incident.check.charger, nb.home.incident.check.chargerText],
  [nb.home.incident.check.cable, nb.home.incident.check.cableText],
  [nb.home.incident.check.zaptecApp, nb.home.incident.check.zaptecAppText],
] as const;

export function IncidentCard({
  card,
  incidentId,
  chargerName,
  preview = false,
}: {
  card: IncidentCardView;
  incidentId: string | null;
  chargerName: string;
  /** Debug preview: no real actions. */
  preview?: boolean;
}) {
  const tone = TONE[card.tone];
  return (
    <div role="status" data-testid="incident-card" data-tone={card.tone} className={`rounded-[var(--radius-card)] border p-4 ${tone.box}`}>
      <div className="flex gap-3">
        <Icon tone={card.tone} />
        <div className="min-w-0">
          {card.title && <p className={`text-[15px] font-semibold ${tone.title}`}>{card.title}</p>}
          <p className={`text-[13px] text-muted ${card.title ? "mt-0.5" : ""}`}>{card.body}</p>
          {card.checklist && (
            <ul className="mt-2 flex flex-col gap-1 text-[13px] text-text-2">
              {CHECKS.map(([label, text]) => (
                <li key={label}>
                  <span className="font-semibold">{label}</span> {text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!preview && (card.retry || card.myOpel) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {card.retry && incidentId && (
            <ActionButton
              action={() => retryIncident(incidentId, chargerName)}
              label={nb.home.incident.retry}
              pendingLabel={nb.actions.working}
              className={outline}
              success={nb.toasts.chargingStarted.title}
              errorMessage={nb.actions.chargeStartFailed}
              settle="charging"
            />
          )}
          {card.myOpel && <MyOpelLink label={nb.home.incident.openMyOpel} className={outline} />}
        </div>
      )}
    </div>
  );
}

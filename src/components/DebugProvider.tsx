"use client";

import { DEBUG_KEY } from "@/lib/ui/debugMode";
import { createContext, useContext, useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DEBUG_SCENARIOS, type DebugScenarioKey } from "@/lib/debug/scenarios";
import { nb, fill } from "@/lib/i18n/nb";

interface DebugContextValue {
  enabled: boolean;
  scenario: DebugScenarioKey;
}

const DebugContext = createContext<DebugContextValue>({ enabled: false, scenario: "real" });

// Lets HomeCard (and anything else) ask "is a debug scenario active, and
// which one" without threading props through the whole tree.
export function useDebugScenario(): DebugContextValue {
  return useContext(DebugContext);
}

const STORAGE_KEY_ENABLED = DEBUG_KEY;
const STORAGE_KEY_SCENARIO = "zaptec-debug-scenario";

// Reads ?debug=1 / ?debug=0 once, persists it, then strips the param from
// the URL -- same pattern as ScheduleCreatedToast elsewhere in this app.
// Split out from DebugProvider because useSearchParams() requires a
// Suspense boundary, which the provider itself (wrapping the whole page)
// shouldn't need to be gated behind.
function DebugQueryParamSync({ onEnabledChange }: { onEnabledChange: (enabled: boolean) => void }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const debugParam = searchParams.get("debug");
    if (debugParam == null) return;
    const next = debugParam === "1";
    onEnabledChange(next);
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, next ? "1" : "0");
    } catch {
      // Private browsing or storage disabled -- the flag just won't persist.
    }
    const params = new URLSearchParams(searchParams);
    params.delete("debug");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    // Only ever meant to run once per ?debug= navigation, not on every
    // searchParams identity change (router.replace would otherwise loop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

export function DebugProvider({
  buildSha,
  buildEnv,
  children,
}: {
  buildSha: string;
  buildEnv: string;
  children: React.ReactNode;
}) {
  const [enabled, setEnabled] = useState(false);
  const [scenario, setScenario] = useState<DebugScenarioKey>("real");

  useEffect(() => {
    // Reading localStorage during render (e.g. a useState lazy initializer)
    // would mismatch the server-rendered HTML, which never had access to the
    // browser's storage -- so this intentionally renders the default on the
    // first pass and syncs the real value right after mount instead.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEnabled(localStorage.getItem(STORAGE_KEY_ENABLED) === "1");
      const stored = localStorage.getItem(STORAGE_KEY_SCENARIO);
      if (stored && (stored === "real" || stored in DEBUG_SCENARIOS)) {
        setScenario(stored as DebugScenarioKey);
      }
    } catch {
      // Private browsing or storage disabled -- just defaults to off.
    }
  }, []);

  function changeScenario(next: DebugScenarioKey) {
    setScenario(next);
    try {
      localStorage.setItem(STORAGE_KEY_SCENARIO, next);
    } catch {
      // ignore
    }
  }

  function exitDebug() {
    setEnabled(false);
    changeScenario("real");
    try {
      localStorage.setItem(STORAGE_KEY_ENABLED, "0");
    } catch {
      // ignore
    }
  }

  return (
    <DebugContext.Provider value={{ enabled, scenario }}>
      <Suspense fallback={null}>
        <DebugQueryParamSync onEnabledChange={setEnabled} />
      </Suspense>
      {enabled && (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-chip)] border border-dashed border-amber-border bg-amber-bg px-3 py-2 text-xs text-amber">
          <span className="font-mono">{fill(nb.debug.build, { sha: buildSha, env: buildEnv })}</span>
          <select
            value={scenario}
            onChange={(event) => changeScenario(event.target.value as DebugScenarioKey)}
            className="min-h-8 cursor-pointer rounded border border-amber-border bg-surface px-1.5 py-0.5 text-text"
          >
            <option value="real">{nb.debug.real}</option>
            {Object.entries(DEBUG_SCENARIOS).map(([key, s]) => (
              <option key={key} value={key}>
                {s.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={exitDebug} className="min-h-8 cursor-pointer underline">
            {nb.debug.exit}
          </button>
        </div>
      )}
      {children}
    </DebugContext.Provider>
  );
}

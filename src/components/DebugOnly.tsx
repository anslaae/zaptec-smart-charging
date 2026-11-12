"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DEBUG_KEY } from "@/lib/ui/debugMode";

// Renders its children only when debug mode is on (Innstillinger → System;
// a per-device switch in localStorage, so it can only be read after mount).
export function DebugOnly({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists after mount
      setOn(localStorage.getItem(DEBUG_KEY) === "1");
    } catch {
      // storage unavailable: stays off
    }
  }, []);
  return on ? <>{children}</> : null;
}

"use client";

import { useEffect, useState } from "react";
import { detectMyOpelPlatform, myOpelOpenUrl, type MyOpelPlatform } from "@/lib/myopel";

// Opens Opel's myOpel app with the per-platform link from src/lib/myopel.ts
// (confirmed on real phones). The platform is only known in the browser, so
// the first render uses the desktop fallback and switches after mount --
// avoids a server/client mismatch now that this can render on page load.
export function MyOpelLink({ label, className }: { label: string; className: string }) {
  const [platform, setPlatform] = useState<MyOpelPlatform>("other");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator only exists after mount
    setPlatform(detectMyOpelPlatform(navigator.userAgent, navigator.maxTouchPoints));
  }, []);

  return (
    <a
      href={myOpelOpenUrl(platform)}
      // App links must open in place: in a new tab, Android leaves a blank
      // tab behind. Only the desktop store fallback gets one.
      target={platform === "other" ? "_blank" : undefined}
      rel="noopener noreferrer"
      className={className}
    >
      {label}
    </a>
  );
}

import Link from "next/link";
import { MOCK_MODE } from "@/lib/mock/mode";
import { MockSync } from "@/components/MockSync";

/** Always-visible strip in mock mode, so it's never mistaken for the real app. */
export function MockBanner() {
  if (!MOCK_MODE) return null;
  return (
    <div className="sticky top-0 z-50 flex items-center justify-between gap-2 border-b border-amber-border bg-amber-bg px-4 py-1.5 text-xs font-semibold text-amber">
      <span>Mock-modus – ingen ekte lader, database eller varsler</span>
      <Link href="/dev/mock" className="flex min-h-8 items-center underline">
        Kontrollpanel
      </Link>
      <MockSync />
    </div>
  );
}

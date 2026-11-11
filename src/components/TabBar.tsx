"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { nb } from "@/lib/i18n/nb";

type IconProps = { className?: string };

function HomeIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M10 21v-6h4v6" />
    </svg>
  );
}

function HistoryIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function InsightsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </svg>
  );
}

function SettingsIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

const TABS = [
  { href: "/", label: nb.nav.home, Icon: HomeIcon },
  { href: "/history", label: nb.nav.history, Icon: HistoryIcon },
  { href: "/insights", label: nb.nav.insights, Icon: InsightsIcon },
  { href: "/settings", label: nb.nav.settings, Icon: SettingsIcon },
] as const;

// 84 px tall plus the iOS home-indicator inset (design/redesign/HANDOFF.md §2).
const BAR_HEIGHT = "calc(84px + env(safe-area-inset-bottom))";

/**
 * Bottom tab bar on every authenticated page. Rendered once from the root
 * layout; hidden on /login. Also renders a spacer so page content never ends
 * up underneath the fixed bar.
 */
export function TabBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <div aria-hidden="true" className="shrink-0" style={{ height: BAR_HEIGHT }} />
      <nav
        aria-label={nb.nav.menuLabel}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-nav"
        style={{ height: BAR_HEIGHT, paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <ul className="mx-auto flex h-[84px] max-w-lg">
          {TABS.map(({ href, label, Icon }) => {
            const active = isActive(href);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex h-full min-h-11 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                    active ? "text-accent" : "text-muted"
                  }`}
                >
                  <Icon className="h-6 w-6" />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

// Placeholder outlines of each screen (D80 rule 2). Used by the screens'
// loading.tsx (a cold load or a cached loading shell) and by ScreenSwap (a tab
// tap whose screen isn't cached yet), so every tab switch looks the same.

export type Screen = "home" | "history" | "insights" | "settings";

const block = "animate-pulse bg-surface-2";

function Frame({ screen, children }: { screen: Screen; children: React.ReactNode }) {
  return (
    <main
      aria-busy="true"
      data-testid={`skeleton-${screen}`}
      className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-4 px-4 pt-6 pb-4"
    >
      {children}
    </main>
  );
}

const Title = ({ width = "w-32" }: { width?: string }) => <div className={`h-8 ${width} rounded ${block}`} />;
const Segments = () => <div className={`h-12 rounded-[var(--radius-chip)] ${block}`} />;
const Card = ({ height }: { height: string }) => <div className={`${height} rounded-[var(--radius-card)] ${block}`} />;

export function ScreenSkeleton({ screen }: { screen: Screen }) {
  switch (screen) {
    case "home":
      // Header, hero card with the ring, recent events.
      return (
        <Frame screen="home">
          <div className="flex flex-col gap-2">
            <div className={`h-4 w-32 rounded ${block}`} />
            <Title width="w-48" />
          </div>
          <div className={`h-[420px] rounded-[var(--radius-hero)] ${block}`} />
          <Card height="h-28" />
        </Frame>
      );
    case "history":
      return (
        <Frame screen="history">
          <Title />
          <Segments />
          <Card height="h-20" />
          <Card height="h-20" />
          <Card height="h-20" />
        </Frame>
      );
    case "insights":
      return (
        <Frame screen="insights">
          <Title />
          <Segments />
          <div className={`mx-auto h-6 w-28 rounded ${block}`} />
          <div className="grid grid-cols-2 gap-3">
            <Card height="h-24" />
            <Card height="h-24" />
          </div>
          <Card height="h-56" />
        </Frame>
      );
    case "settings":
      return (
        <Frame screen="settings">
          <Title width="w-40" />
          <Card height="h-32" />
          <Card height="h-32" />
          <Card height="h-32" />
        </Frame>
      );
  }
}

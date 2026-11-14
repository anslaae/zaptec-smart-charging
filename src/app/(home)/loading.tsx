import { ScreenSkeleton } from "@/components/Skeletons";

// Hjem placeholder while the server renders (D80; shared with the tab bar's ScreenSwap).
export default function Loading() {
  return <ScreenSkeleton screen="home" />;
}

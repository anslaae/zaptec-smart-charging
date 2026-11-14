import { ScreenSkeleton } from "@/components/Skeletons";

// Innsikt placeholder while the server renders (D80; shared with the tab bar's ScreenSwap).
export default function Loading() {
  return <ScreenSkeleton screen="insights" />;
}

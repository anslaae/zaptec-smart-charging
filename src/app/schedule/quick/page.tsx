import { redirect } from "next/navigation";

// Old plan form URL (bookmarks, earlier push notifications). The plan sheet
// on Hjem replaced it (design/redesign/HANDOFF.md §1).
export default function QuickSchedulePage() {
  redirect("/?sheet=plan");
}

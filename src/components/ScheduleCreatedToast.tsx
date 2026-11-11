"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { fill, nb } from "@/lib/i18n/nb";

// createSchedule() redirects here with ?created=1 since it can't show a
// toast itself (the component unmounts on redirect). Fires once, then
// cleans the param off the URL so refreshing doesn't repeat it.
export function ScheduleCreatedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("created") === "1") {
      const t = nb.toasts.planSaved;
      if (searchParams.get("tight") === "1") {
        toast.warning(t.title, { description: nb.actions.planCreatedTight });
      } else {
        const start = searchParams.get("start");
        const readyBy = searchParams.get("ready");
        toast.success(t.title, {
          description: start && readyBy ? fill(t.body, { start, readyBy }) : undefined,
        });
      }
      router.replace("/");
    }
  }, [searchParams, router]);

  return null;
}

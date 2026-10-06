"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

// createSchedule() redirects here with ?created=1 since it can't show a
// toast itself (the component unmounts on redirect). Fires once, then
// cleans the param off the URL so refreshing doesn't repeat it.
export function ScheduleCreatedToast() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("created") === "1") {
      toast.success("Charging planned");
      router.replace("/");
    }
  }, [searchParams, router]);

  return null;
}

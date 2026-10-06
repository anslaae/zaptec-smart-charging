"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { deleteSchedule, type ActionResult } from "@/lib/schedules/actions";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ActionResult = {};

export function DeleteScheduleButton({ scheduleId }: { scheduleId: string }) {
  const [state, formAction] = useActionState(deleteSchedule.bind(null, scheduleId), initialState);

  useEffect(() => {
    if (state.error) {
      toast.error("Couldn't delete the schedule", { description: state.error });
    } else if (state.success) {
      toast.success("Schedule deleted");
    }
  }, [state]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!confirm("Delete this schedule? This can't be undone.")) {
          event.preventDefault();
        }
      }}
    >
      <SubmitButton
        pendingLabel="Deleting…"
        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
      >
        Delete
      </SubmitButton>
    </form>
  );
}

"use client";

import { useFormStatus } from "react-dom";
import { useFreshness } from "@/components/Freshness";

// Plain <button type="submit"> gives zero feedback while a server action is
// in flight, which reads as "the app isn't responding" even when the
// command actually went through fine. useFormStatus needs a client
// component that's a child of the <form>, not the form itself.
export function SubmitButton({
  children,
  pendingLabel,
  className,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  // D71: locked while the screen shows an out-of-date status or waits for the charger.
  const { locked } = useFreshness();
  return (
    <button
      type="submit"
      disabled={pending || locked}
      className={`${className} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

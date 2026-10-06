"use client";

import { useFormStatus } from "react-dom";

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
  return (
    <button
      type="submit"
      disabled={pending}
      className={`${className} cursor-pointer disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

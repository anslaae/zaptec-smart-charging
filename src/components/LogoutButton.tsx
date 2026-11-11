"use client";

import { useTransition } from "react";
import { logout } from "@/lib/auth/actions";
import { unsubscribeFromPush } from "@/lib/push/actions";
import { useConfirm } from "@/components/ConfirmDialog";
import { logoutDialog } from "@/lib/ui/dialogs";
import { nb } from "@/lib/i18n/nb";

// Logg ut asks first (HANDOFF §3b). As the dialog says, this device's push
// notifications are switched off too -- otherwise a logged-out phone would
// keep getting the household's charging alerts.
export function LogoutButton() {
  const confirm = useConfirm();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        if (!(await confirm(logoutDialog()))) return;
        startTransition(async () => {
          try {
            const registration = await navigator.serviceWorker?.getRegistration();
            const subscription = await registration?.pushManager.getSubscription();
            if (subscription) {
              await unsubscribeFromPush(subscription.endpoint);
              await subscription.unsubscribe();
            }
          } catch {
            // No push on this device, or the browser refused -- log out anyway.
          }
          await logout();
        });
      }}
      className="flex min-h-11 cursor-pointer items-center self-start text-[15px] font-semibold text-danger disabled:opacity-60"
    >
      {pending ? nb.actions.working : nb.settings.account.logout}
    </button>
  );
}

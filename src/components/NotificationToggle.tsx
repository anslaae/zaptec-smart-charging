"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push/actions";
import { nb } from "@/lib/i18n/nb";
import { Switch } from "@/components/Switch";

// Push subscription keys arrive as base64url; the Push API wants a raw
// Uint8Array for applicationServerKey. Standard boilerplate conversion.
function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

type Support = "checking" | "unsupported" | "supported";

// Opt-in, off by default -- this only ever reflects/changes the current
// browser's own subscription (checked via the Push API itself on mount), not
// some separate app-level setting, since that's what Web Push actually is.
export function NotificationToggle() {
  const [support, setSupport] = useState<Support>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // Feature/subscription detection can only happen client-side, after
    // mount -- the server has no notion of this browser's capabilities or
    // its existing Push subscription, so there's no way to know either
    // without an effect.
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupport("unsupported");
      return;
    }
    setSupport("supported");

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => registration.pushManager.getSubscription())
      .then((existing) => setSubscribed(existing != null))
      .catch(() => setSupport("unsupported"));
  }, []);

  async function enable() {
    setPending(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error(nb.settings.notifications.blocked, { description: nb.settings.notifications.blockedSub });
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        toast.error(nb.settings.notifications.notConfigured);
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        // TS's DOM lib types applicationServerKey as BufferSource typed over
        // a plain ArrayBuffer specifically, which a Uint8Array<ArrayBufferLike>
        // (what Uint8Array.from returns) doesn't structurally satisfy, even
        // though it's a valid BufferSource at runtime.
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      const result = await subscribeToPush(subscription.toJSON());
      if (result.error) {
        toast.error(nb.settings.notifications.enableFailed, { description: result.error });
        await subscription.unsubscribe();
        return;
      }

      setSubscribed(true);
      toast.success(nb.settings.notifications.enabled);
    } catch {
      toast.error(nb.settings.notifications.enableFailed);
    } finally {
      setPending(false);
    }
  }

  async function disable() {
    setPending(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribeFromPush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setSubscribed(false);
      toast.success(nb.settings.notifications.disabled);
    } catch {
      toast.error(nb.settings.notifications.disableFailed);
    } finally {
      setPending(false);
    }
  }

  if (support === "checking") return null;
  if (support === "unsupported") {
    return <p className="text-sm text-muted">{nb.settings.notifications.unsupported}</p>;
  }

  // Per-device switch row for Innstillinger -> Varsler.
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[15px] font-semibold">{nb.settings.notifications.thisDevice}</p>
        <p className="text-xs text-muted">{nb.settings.notifications.thisDeviceSub}</p>
      </div>
      <Switch
        checked={subscribed}
        disabled={pending}
        label={nb.settings.notifications.thisDevice}
        onChange={(next) => (next ? enable() : disable())}
      />
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { subscribeToPush, unsubscribeFromPush } from "@/lib/push/actions";

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
        toast.error("Notifications blocked", {
          description: "Allow notifications for this site in your browser settings to enable it.",
        });
        return;
      }

      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) {
        toast.error("Notifications aren't configured on this deployment.");
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
        toast.error("Couldn't enable notifications", { description: result.error });
        await subscription.unsubscribe();
        return;
      }

      setSubscribed(true);
      toast.success("Notifications enabled");
    } catch {
      toast.error("Couldn't enable notifications on this device.");
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
      toast.success("Notifications disabled");
    } catch {
      toast.error("Couldn't disable notifications on this device.");
    } finally {
      setPending(false);
    }
  }

  if (support !== "supported") return null;

  return (
    <button
      type="button"
      disabled={pending}
      onClick={subscribed ? disable : enable}
      className="cursor-pointer text-sm text-black/60 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-white/60"
    >
      {subscribed ? "Notifications on" : "Enable notifications"}
    </button>
  );
}

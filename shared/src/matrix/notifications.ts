import { useCallback, useEffect, useState } from "react";
import type { IPusherRequest, MatrixClient } from "matrix-js-sdk";
import type { NotificationPermissionState, PlatformAdapter } from "../platform";

export const NOTIFICATIONS_KEY = "abea.notifications";
const PUSHER_KEY = "abea.pusher";
const CHANGED_EVENT = "abea:notifications-changed";

export function notificationsEnabled(): boolean {
  return localStorage.getItem(NOTIFICATIONS_KEY) !== "0";
}

export function setNotificationsEnabled(on: boolean): void {
  localStorage.setItem(NOTIFICATIONS_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useNotificationsEnabled(): boolean {
  const [enabled, setEnabled] = useState(notificationsEnabled);
  useEffect(() => {
    const update = () => setEnabled(notificationsEnabled());
    window.addEventListener(CHANGED_EVENT, update);
    return () => window.removeEventListener(CHANGED_EVENT, update);
  }, []);
  return enabled;
}

function webPermission(): NotificationPermissionState {
  if (!("Notification" in window)) return "denied";
  return Notification.permission === "default" ? "prompt" : Notification.permission;
}

/**
 * Current OS / browser permission to show notifications. Re-checked when the app comes back to the
 * foreground, since users may change it in the system settings meanwhile.
 */
export function useNotificationPermission(platform: PlatformAdapter): {
  permission: NotificationPermissionState | null;
  request: () => Promise<NotificationPermissionState>;
} {
  const native = platform.notificationPermission;
  const [permission, setPermission] = useState<NotificationPermissionState | null>(() =>
    native ? null : platform.notify ? "granted" : webPermission(),
  );

  useEffect(() => {
    if (!native) return;
    let alive = true;
    const check = () =>
      void native
        .check()
        .then((p) => alive && setPermission(p))
        .catch(() => alive && setPermission("denied"));
    check();
    const onVisible = () => !document.hidden && check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", check);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", check);
    };
  }, [native]);

  const request = useCallback(async () => {
    let result: NotificationPermissionState;
    if (native) result = await native.request().catch(() => "denied" as const);
    else if (platform.notify) result = "granted";
    else if ("Notification" in window) {
      const p = await Notification.requestPermission();
      result = p === "default" ? "prompt" : p;
    } else result = "denied";
    setPermission(result);
    return result;
  }, [native, platform.notify]);

  return { permission, request };
}

/* -------------------------------------------------------------------------------------------------
 * Push (pushers)
 * -----------------------------------------------------------------------------------------------*/

interface StoredPusher {
  userId: string;
  appId: string;
  pushkey: string;
}

function readStoredPusher(): StoredPusher | null {
  try {
    return JSON.parse(localStorage.getItem(PUSHER_KEY) ?? "null") as StoredPusher | null;
  } catch {
    return null;
  }
}

/**
 * Registers (or removes) the homeserver pusher that delivers push notifications to this device
 * while ABEA isn't running. See https://spec.matrix.org/latest/client-server-api/#push-notifications
 */
export async function syncPusher(client: MatrixClient, platform: PlatformAdapter, enabled: boolean): Promise<void> {
  const stored = readStoredPusher();
  const userId = client.getUserId()!;

  if (!enabled || !platform.registerPush) {
    if (stored && stored.userId === userId) {
      await client
        .setPusher({ app_id: stored.appId, pushkey: stored.pushkey, kind: null } as unknown as IPusherRequest)
        .catch((e) => console.warn("Could not remove pusher", e));
    }
    localStorage.removeItem(PUSHER_KEY);
    return;
  }

  const registration = await platform.registerPush();
  if (!registration) return;
  // A new token replaces the old pusher of this device.
  if (stored && stored.userId === userId && (stored.pushkey !== registration.pushkey || stored.appId !== registration.appId)) {
    await client
      .setPusher({ app_id: stored.appId, pushkey: stored.pushkey, kind: null } as unknown as IPusherRequest)
      .catch(() => undefined);
  }
  await client.setPusher({
    kind: "http",
    app_id: registration.appId,
    pushkey: registration.pushkey,
    app_display_name: "ABEA",
    device_display_name: `ABEA ${platform.os === "ios" ? "iOS" : platform.os === "android" ? "Android" : platform.os}`,
    lang: navigator.language || "en",
    data: registration.data,
    append: false,
  } as IPusherRequest);
  localStorage.setItem(PUSHER_KEY, JSON.stringify({ userId, appId: registration.appId, pushkey: registration.pushkey }));
}

/** Java's String.hashCode, made non-negative: stable per-room notification ids shared with native code. */
export function roomNotificationId(roomId: string): number {
  let h = 0;
  for (let i = 0; i < roomId.length; i++) h = (Math.imul(31, h) + roomId.charCodeAt(i)) | 0;
  return h & 0x7fffffff;
}

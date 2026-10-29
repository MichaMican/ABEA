import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import { navigate, roomNotificationId, type NotificationPermissionState, type PlatformAdapter, type PushRegistration } from "@abea/shared";

const native = Capacitor.isNativePlatform();
const os = Capacitor.getPlatform();

/** Shared with the native Android push service (AbeaMessagingService.CHANNEL_ID). */
const CHANNEL_ID = "messages";

/**
 * Push gateway (Sygnal) endpoint, e.g. https://push.example.com/_matrix/push/v1/notify.
 * Push is only enabled when set at build time, because registering with FCM without a
 * google-services.json crashes the Android app.
 */
const PUSH_GATEWAY = (import.meta.env.VITE_PUSH_GATEWAY as string | undefined)?.trim() || "";
const PUSH_APP_ID =
  (os === "ios" ? import.meta.env.VITE_PUSH_APP_ID_IOS : import.meta.env.VITE_PUSH_APP_ID_ANDROID) || `app.abea.messenger.${os}`;

function openRoom(roomId: string | undefined) {
  if (roomId) navigate({ section: "chats", roomId });
}

// ---- App state -------------------------------------------------------------------------------

let foreground = true;
if (native) {
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    foreground = isActive;
  });
}

// ---- Permission ------------------------------------------------------------------------------

function mapPermission(display: string): NotificationPermissionState {
  if (display === "granted") return "granted";
  if (display === "denied") return "denied";
  return "prompt";
}

const permission = {
  check: async () => mapPermission((await LocalNotifications.checkPermissions()).display),
  request: async () => {
    const status = await LocalNotifications.checkPermissions();
    if (status.display === "granted" || status.display === "denied") return mapPermission(status.display);
    return mapPermission((await LocalNotifications.requestPermissions()).display);
  },
};

// ---- Local notifications ---------------------------------------------------------------------

let fallbackId = 1;
const clickHandlers = new Map<number, () => void>();

async function setUpLocalNotifications() {
  if (os === "android") {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "Messages",
      description: "New messages in your chats",
      importance: 4,
      visibility: 0,
      vibration: true,
      lights: true,
      lightColor: "#6a6dff",
    }).catch(() => undefined);
  }
  await LocalNotifications.addListener("localNotificationActionPerformed", ({ notification }) => {
    const handler = clickHandlers.get(notification.id);
    clickHandlers.delete(notification.id);
    if (handler) handler();
    else openRoom((notification.extra as { roomId?: string } | undefined)?.roomId);
  });
}

const notify: PlatformAdapter["notify"] = (title, body, onClick, options) => {
  void (async () => {
    if ((await permission.check()) !== "granted") return;
    // One notification per conversation: a newer message replaces the previous one.
    const id = options?.roomId ? roomNotificationId(options.roomId) : 0x7fff0000 + (fallbackId++ % 0xffff);
    clickHandlers.set(id, onClick);
    if (clickHandlers.size > 100) clickHandlers.delete(clickHandlers.keys().next().value!);
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          largeBody: body,
          channelId: CHANNEL_ID,
          group: "abea.messages",
          threadIdentifier: options?.roomId,
          summaryText: options?.isDirect ? undefined : options?.roomName,
          extra: { roomId: options?.roomId },
          autoCancel: true,
        },
      ],
    });
  })().catch((e) => console.warn("Notification failed", e));
};

async function clearNotifications(roomId: string) {
  const id = roomNotificationId(roomId);
  await LocalNotifications.removeDeliveredNotifications({ notifications: [{ id, title: "", body: "" }] }).catch(() => undefined);
  if (PUSH_GATEWAY && os === "ios") {
    // APNs notifications carry the room in their payload instead of a predictable id.
    const { notifications } = await PushNotifications.getDeliveredNotifications().catch(() => ({ notifications: [] }));
    const forRoom = notifications.filter((n) => (n.data as { room_id?: string } | undefined)?.room_id === roomId);
    if (forRoom.length) await PushNotifications.removeDeliveredNotifications({ notifications: forRoom }).catch(() => undefined);
  }
}

// ---- Remote push -----------------------------------------------------------------------------

let pushToken: Promise<string> | null = null;

function obtainPushToken(): Promise<string> {
  pushToken ??= new Promise<string>((resolve, reject) => {
    void PushNotifications.addListener("registration", (token) => resolve(token.value));
    void PushNotifications.addListener("registrationError", (err) => reject(new Error(err.error)));
    void PushNotifications.register().catch(reject);
  }).catch((e) => {
    pushToken = null;
    throw e;
  });
  return pushToken;
}

async function registerPush(): Promise<PushRegistration | null> {
  let status = await PushNotifications.checkPermissions();
  if (status.receive === "prompt" || status.receive === "prompt-with-rationale") {
    status = await PushNotifications.requestPermissions();
  }
  if (status.receive !== "granted") return null;
  const pushkey = await obtainPushToken();
  return {
    appId: PUSH_APP_ID,
    pushkey,
    data:
      os === "ios"
        ? {
            url: PUSH_GATEWAY,
            // Message content never leaves the homeserver; iOS shows a generic alert.
            format: "event_id_only",
            default_payload: { aps: { alert: { title: "ABEA", body: "New message" }, sound: "default", "mutable-content": 1 } },
          }
        : // Android: the native AbeaMessagingService builds the notification from room/sender names.
          { url: PUSH_GATEWAY },
  };
}

function setUpPush() {
  // Tapping an APNs notification (iOS).
  void PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
    openRoom((notification.data as { room_id?: string } | undefined)?.room_id);
  });
}

// ---- Deep links (abea://room/<roomId>, used by the native Android push service) --------------

function handleUrl(url: string | undefined) {
  const match = url?.match(/^abea:\/\/room\/(.+)$/);
  if (match) openRoom(decodeURIComponent(match[1]));
}

// ---- Public ----------------------------------------------------------------------------------

export function setUpNotifications(): Pick<
  PlatformAdapter,
  "notify" | "notificationPermission" | "clearNotifications" | "registerPush" | "isForeground"
> {
  if (!native) return {};
  void setUpLocalNotifications();
  if (PUSH_GATEWAY) setUpPush();
  void CapApp.addListener("appUrlOpen", ({ url }) => handleUrl(url));
  void CapApp.getLaunchUrl()
    .then((launch) => handleUrl(launch?.url))
    .catch(() => undefined);
  return {
    notify,
    notificationPermission: permission,
    clearNotifications: (roomId) => void clearNotifications(roomId),
    registerPush: PUSH_GATEWAY ? registerPush : undefined,
    isForeground: () => foreground,
  };
}

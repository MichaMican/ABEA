import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { ChatNotificationAction, DeliveredChatNotification, NotifyOptions, PlatformAdapter } from "@abea/shared";

interface ChatNotificationsPlugin {
  configure(state: { userId: string | null; enabled: boolean }): Promise<void>;
  show(options: NotifyOptions & { body: string }): Promise<void>;
  delivered(): Promise<{ notifications: DeliveredChatNotification[] }>;
  clear(options: { roomId: string; eventId?: string }): Promise<void>;
  pending(): Promise<{ actions: ChatNotificationAction[] }>;
  complete(options: { id: string }): Promise<void>;
  status(options: { id: string; text: string }): Promise<void>;
  addListener(event: "actionsChanged", handler: () => void): Promise<PluginListenerHandle>;
}

const ChatNotifications = registerPlugin<ChatNotificationsPlugin>("ChatNotifications");
let actionHandler: ((action: ChatNotificationAction) => Promise<void>) | undefined;
let draining = false;
let dirty = false;

async function drainActions() {
  dirty = true;
  if (draining || !actionHandler) return;
  draining = true;
  const attempted = new Set<string>();
  try {
    while (dirty && actionHandler) {
      dirty = false;
      const { actions } = await ChatNotifications.pending();
      for (const action of actions) {
        const handler = actionHandler;
        if (!handler) break;
        if (attempted.has(action.id)) continue;
        attempted.add(action.id);
        try {
          await ChatNotifications.status({
            id: action.id,
            text: action.type === "reply" ? "Sending reply…" : "Marking as read…",
          });
          await handler(action);
          await ChatNotifications.complete({ id: action.id });
        } catch (error) {
          console.error("Notification action failed", error);
          await ChatNotifications.status({
            id: action.id,
            text: action.type === "reply" ? "Reply not sent. Open ABEA to retry." : "Not marked as read. Open ABEA to retry.",
          });
        }
      }
    }
  } finally {
    draining = false;
  }
}

const drain = () => void drainActions().catch((error) => console.error("Could not process notification actions", error));

export function androidNotifications(): Pick<
  PlatformAdapter,
  "notify" | "clearNotifications" | "getDeliveredNotifications" | "onNotificationAction" | "setNotificationState"
> {
  void ChatNotifications.addListener("actionsChanged", drain).catch((error) => console.error("Notification listener failed", error));
  window.addEventListener("abea:foreground", drain);
  return {
    notify: (_title, body, _onClick, options) => {
      if (!options?.roomId || !options.eventId) {
        console.error("Cannot show a chat notification without its room and event id");
        return;
      }
      void ChatNotifications.show({ ...options, body }).catch((error) => console.error("Notification failed", error));
    },
    getDeliveredNotifications: async () => (await ChatNotifications.delivered()).notifications,
    clearNotifications: (roomId, eventId) => ChatNotifications.clear({ roomId, eventId }),
    setNotificationState: (state) => ChatNotifications.configure(state),
    onNotificationAction: (handler) => {
      actionHandler = handler;
      drain();
      return () => {
        if (actionHandler === handler) actionHandler = undefined;
      };
    },
  };
}

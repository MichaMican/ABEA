import { createContext, useContext } from "react";

export type PlatformKind = "web" | "desktop" | "mobile";

/**
 * Each app variant (web, desktop, mobile) provides an adapter so the shared UI can use
 * native capabilities without depending on Electron or Capacitor directly.
 */
export interface PlatformAdapter {
  kind: PlatformKind;
  /** "mac" | "windows" | "linux" | "android" | "ios" | "web" */
  os: string;
  /** Opens a URL outside of the app (system browser). */
  openExternal?: (url: string) => void;
  /** Called whenever the effective color scheme changes (e.g. to tint native status bars). */
  onThemeChange?: (theme: "light" | "dark") => void;
  /** Total unread count, for dock / taskbar badges. */
  setBadgeCount?: (count: number) => void;
  /** Shows a system notification. Falls back to the Web Notification API when omitted. */
  notify?: (title: string, body: string, onClick: () => void, options?: NotifyOptions) => void;
  /** Native notification permission handling (mobile). */
  notificationPermission?: {
    check: () => Promise<NotificationPermissionState>;
    request: () => Promise<NotificationPermissionState>;
    /** Opens the system notification settings for the app, if possible. */
    openSettings?: () => void;
  };
  /** Removes notifications of a room that were already delivered (e.g. after it was read). */
  clearNotifications?: (roomId: string, eventId?: string) => void | Promise<void>;
  getDeliveredNotifications?: () => Promise<DeliveredChatNotification[]>;
  onNotificationAction?: (handler: (action: ChatNotificationAction) => Promise<void>) => () => void;
  setNotificationState?: (state: { userId: string | null; enabled: boolean }) => Promise<void>;
  /**
   * Registers for remote push (FCM / APNs). Resolves with the pusher to register on the homeserver,
   * or null when push isn't configured for this build.
   */
  registerPush?: () => Promise<PushRegistration | null>;
  /** Whether the app is currently visible to the user (native apps keep running in background). */
  isForeground?: () => boolean;
  /** Whether SSO login via full-page redirect is available. */
  supportsSsoRedirect?: boolean;
  /** Whether the window draws its own title bar area (macOS hidden inset title bar). */
  insetTitleBar?: boolean;
}

export interface NotifyOptions {
  roomId?: string;
  /** Name of the conversation, used to group notifications. */
  roomName?: string;
  isDirect?: boolean;
  eventId?: string;
  senderId?: string;
  senderName?: string;
  timestamp?: number;
}

export interface DeliveredChatNotification {
  roomId: string;
  eventId: string;
}

export interface ChatNotificationAction extends DeliveredChatNotification {
  id: string;
  userId: string;
  type: "read" | "reply";
  reply?: string;
}

export type NotificationPermissionState = "granted" | "denied" | "prompt";

/** A Matrix HTTP pusher: https://spec.matrix.org/latest/client-server-api/#post_matrixclientv3pushersset */
export interface PushRegistration {
  appId: string;
  pushkey: string;
  /** Pusher data; must contain the push gateway `url`. */
  data: { url: string; format?: "event_id_only"; [key: string]: unknown };
}

export const defaultPlatform: PlatformAdapter = { kind: "web", os: "web", supportsSsoRedirect: true };

export const PlatformContext = createContext<PlatformAdapter>(defaultPlatform);

export function usePlatform(): PlatformAdapter {
  return useContext(PlatformContext);
}

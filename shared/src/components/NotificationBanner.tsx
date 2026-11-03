import { useState } from "react";
import { BellOff, X } from "lucide-react";
import { usePlatform } from "../platform";
import { useNotificationPermission, useNotificationsEnabled } from "../matrix/notifications";
import { Button } from "./ui";

const DISMISSED_KEY = "abea.notificationBanner";

/** Warning above the chat list while ABEA may not show notifications. Dismissed until the next launch. */
export function NotificationBanner() {
  const platform = usePlatform();
  const enabled = useNotificationsEnabled();
  const { permission, request } = useNotificationPermission(platform);
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISSED_KEY) === "1");
  const [busy, setBusy] = useState(false);
  // Users who turned notifications off in ABEA's settings don't want them.
  if (!enabled || permission === null || permission === "granted" || dismissed) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, "1");
    setDismissed(true);
  };
  const allow = async () => {
    setBusy(true);
    try {
      await request();
    } finally {
      setBusy(false);
    }
  };
  // Once denied for good, the OS won't show the dialog again: only its settings can turn them on.
  const openSettings = permission === "denied" ? platform.notificationPermission?.openSettings : undefined;
  const hint =
    permission === "prompt"
      ? "Allow notifications so you don't miss new messages."
      : platform.kind === "mobile"
        ? "Turn them on for ABEA in your system settings."
        : "Allow notifications for ABEA in your browser's site settings.";

  return (
    <div className="security-banner security-banner--warning" role="status" aria-label="Notifications are off">
      <BellOff size={20} />
      <div className="security-banner__text">
        <strong>Notifications are off</strong>
        <span>{hint}</span>
      </div>
      {permission === "prompt" && (
        <Button size="sm" loading={busy} onClick={() => void allow()}>
          Allow
        </Button>
      )}
      {openSettings && (
        <Button size="sm" onClick={openSettings}>
          Settings
        </Button>
      )}
      <button className="security-banner__close" aria-label="Dismiss" onClick={dismiss}>
        <X size={16} />
      </button>
    </div>
  );
}

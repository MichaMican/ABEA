import { useState } from "react";
import { Info, LogOut, Monitor, Moon, Sun, UserX } from "lucide-react";
import { useMatrix } from "../matrix/MatrixContext";
import { invalidateProfile, useIgnoredUsers, useProfile } from "../matrix/hooks";
import { uploadAvatar } from "../matrix/media";
import { useTheme, type ThemePreference } from "../theme/ThemeProvider";
import { usePlatform } from "../platform";
import { AvatarPicker } from "../components/AvatarPicker";
import { Avatar } from "../components/Avatar";
import { Button, Switch } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Lightbox, type LightboxImage } from "../components/Lightbox";
import { useToast } from "../components/Toast";
import { EditableText } from "./RoomInfo";
import { SecuritySettings } from "../components/Security";
import { setNotificationsEnabled, useNotificationPermission, useNotificationsEnabled } from "../matrix/notifications";

const THEMES: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

export function SettingsView() {
  const { client, cryptoEnabled, logout } = useMatrix();
  const toast = useToast();
  const platform = usePlatform();
  const { preference, setPreference } = useTheme();
  const me = client.getUserId()!;
  const profile = useProfile(me);
  const ignored = useIgnoredUsers();
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const notifications = useNotificationsEnabled();
  const { permission, request: requestPermission } = useNotificationPermission(platform);
  const blocked = permission === "denied";

  const toggleNotifications = async (on: boolean) => {
    if (on && permission !== "granted") {
      const result = await requestPermission();
      if (result !== "granted") {
        toast.show(
          platform.kind === "mobile"
            ? "Allow notifications for ABEA in your system settings."
            : "Notifications are blocked by your browser settings.",
        );
        return;
      }
    }
    setNotificationsEnabled(on);
  };

  const name = profile?.displayName ?? me;
  return (
    <div className="settings">
      <div className="settings__inner">
        <h1 className="settings__title">Settings</h1>

        <section className="settings-card settings-profile">
          <AvatarPicker
            mxc={profile?.avatarMxc}
            name={name}
            id={me}
            size={104}
            busy={avatarBusy}
            onView={profile?.avatarMxc ? () => setLightbox({ mxc: profile.avatarMxc!, name }) : undefined}
            onPick={async (file) => {
              setAvatarBusy(true);
              try {
                const url = await uploadAvatar(client, file);
                await client.setAvatarUrl(url);
                invalidateProfile(me);
                toast.show("Profile picture updated", "success");
              } catch (e) {
                toast.error(e, "Could not update profile picture");
              } finally {
                setAvatarBusy(false);
              }
            }}
          />
          <div className="settings-profile__text">
            <EditableText
              value={name}
              editable
              className="settings-profile__name"
              placeholder="Display name"
              onSave={async (v) => {
                await client.setDisplayName(v);
                invalidateProfile(me);
                toast.show("Display name updated", "success");
              }}
            />
            <div className="settings-profile__id">{me}</div>
            <div className="settings-profile__server">{client.getHomeserverUrl().replace(/^https?:\/\//, "")}</div>
          </div>
        </section>

        <h2 className="settings__section">Appearance</h2>
        <section className="settings-card">
          <div className="theme-picker">
            {THEMES.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                className={`theme-option theme-option--${id} ${preference === id ? "is-active" : ""}`}
                onClick={() => setPreference(id)}
                aria-pressed={preference === id}
              >
                <span className="theme-option__preview">
                  <span className="tp-sidebar" />
                  <span className="tp-main">
                    <span className="tp-bubble tp-bubble--in" />
                    <span className="tp-bubble tp-bubble--out" />
                    <span className="tp-bubble tp-bubble--in tp-bubble--short" />
                  </span>
                </span>
                <span className="theme-option__label">
                  <Icon size={16} /> {label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <h2 className="settings__section">Notifications</h2>
        <section className="settings-card">
          <Switch
            checked={notifications && permission === "granted"}
            onChange={toggleNotifications}
            label="Message notifications"
            description={
              blocked
                ? platform.kind === "mobile"
                  ? "Notifications are turned off for ABEA in your system settings."
                  : "Notifications are blocked by your browser settings."
                : platform.kind === "mobile"
                  ? platform.registerPush
                    ? "Get notified about new messages, even when ABEA is closed."
                    : "Get notified about new messages while ABEA is running in the background."
                  : "Show a notification for new messages when ABEA is in the background."
            }
            disabled={blocked || permission === null}
          />
          {blocked && platform.notificationPermission?.openSettings && (
            <Button size="sm" variant="secondary" style={{ marginTop: 12 }} onClick={platform.notificationPermission.openSettings}>
              Open system settings
            </Button>
          )}
        </section>

        <h2 className="settings__section">Security</h2>
        <SecuritySettings />

        <h2 className="settings__section">Privacy</h2>
        <section className="settings-card settings-list">
          <div className="settings-row settings-row--top">
            <UserX size={20} className="muted" />
            <div className="settings-row__text">
              <span>Blocked users</span>
              {ignored.length === 0 ? (
                <small>You haven't blocked anyone.</small>
              ) : (
                <div className="blocked-list">
                  {ignored.map((u) => (
                    <BlockedUser
                      key={u}
                      userId={u}
                      onUnblock={async () => {
                        try {
                          await client.setIgnoredUsers(client.getIgnoredUsers().filter((x) => x !== u));
                        } catch (e) {
                          toast.error(e);
                        }
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <h2 className="settings__section">About</h2>
        <section className="settings-card settings-list">
          <div className="settings-row">
            <Info size={20} className="muted" />
            <div className="settings-row__text">
              <span>ABEA {__ABEA_VERSION__}</span>
              <small>
                {platform.kind === "desktop" ? "Desktop" : platform.kind === "mobile" ? "Mobile" : "Web"} app · Built on the open Matrix
                protocol
              </small>
            </div>
          </div>
        </section>

        <Button variant="danger" size="lg" block icon={<LogOut size={18} />} onClick={() => setConfirmLogout(true)} className="settings__logout">
          Sign out
        </Button>
      </div>
      <ConfirmDialog
        open={confirmLogout}
        title="Sign out?"
        message={
          cryptoEnabled
            ? "Signing out removes this device's encryption keys. Messages in encrypted chats may become unreadable on this device."
            : "You will need to sign in again to use ABEA on this device."
        }
        confirmLabel="Sign out"
        danger
        onClose={() => setConfirmLogout(false)}
        onConfirm={logout}
      />
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function BlockedUser({ userId, onUnblock }: { userId: string; onUnblock: () => void }) {
  const profile = useProfile(userId);
  return (
    <div className="blocked-user">
      <Avatar mxc={profile?.avatarMxc} name={profile?.displayName ?? userId} id={userId} size={30} />
      <span>{profile?.displayName ?? userId}</span>
      <Button size="sm" variant="secondary" onClick={onUnblock}>
        Unblock
      </Button>
    </div>
  );
}

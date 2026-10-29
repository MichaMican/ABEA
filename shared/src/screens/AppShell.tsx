import { useEffect, useRef, useState } from "react";
import { RoomEvent, SyncState, type MatrixEvent, type Room } from "matrix-js-sdk";
import { MessageCircle, Settings as SettingsIcon, Users } from "lucide-react";
import { useMatrixClient } from "../matrix/MatrixContext";
import { navigate, navigateUp, useRoute, type Route, type Section } from "../router";
import { usePlatform } from "../platform";
import { getRoomName, useProfile, useRoomSummaries } from "../matrix/hooks";
import { Avatar } from "../components/Avatar";
import { Logo } from "../components/Logo";
import { ChatList } from "./ChatList";
import { RoomView } from "./RoomView";
import { RoomInfo } from "./RoomInfo";
import { ContactList } from "./ContactList";
import { ContactProfile } from "./ContactProfile";
import { SettingsView } from "./SettingsView";
import { Welcome } from "./Welcome";
import { classifyEvent, messagePreview, senderName } from "../matrix/events";
import { getDmPartner } from "../matrix/rooms";
import { EmptyState } from "../components/ui";
import { notificationsEnabled, syncPusher, useNotificationsEnabled } from "../matrix/notifications";

export { NOTIFICATIONS_KEY } from "../matrix/notifications";

export function useIsCompact(): boolean {
  const platform = usePlatform();
  const query = "(max-width: 820px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return platform.kind === "mobile" || narrow;
}

function useIsWide(): boolean {
  const query = "(min-width: 1280px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}

const NAV: { section: Section; label: string; icon: typeof MessageCircle }[] = [
  { section: "chats", label: "Chats", icon: MessageCircle },
  { section: "contacts", label: "Contacts", icon: Users },
  { section: "settings", label: "Settings", icon: SettingsIcon },
];

export function AppShell() {
  const route = useRoute();
  const compact = useIsCompact();
  const wide = useIsWide();
  useNotifications(route);
  useBackButton(route);

  if (compact) return <CompactShell route={route} />;

  const main = (() => {
    if (route.section === "settings") return <SettingsView />;
    if (route.section === "contacts") {
      return route.userId ? <ContactProfile userId={route.userId} key={route.userId} /> : <ContactsPlaceholder />;
    }
    if (route.roomId) {
      const infoOpen = route.panel === "info";
      return (
        <div className={`room-split ${infoOpen ? "has-info" : ""} ${wide ? "is-wide" : ""}`}>
          <RoomView roomId={route.roomId} key={route.roomId} />
          {infoOpen && (
            <aside className="room-split__info">
              <RoomInfo roomId={route.roomId} key={`info-${route.roomId}`} />
            </aside>
          )}
        </div>
      );
    }
    return <Welcome />;
  })();

  return (
    <div className={`shell ${route.section === "settings" ? "shell--settings" : ""}`}>
      <NavRail route={route} />
      {route.section !== "settings" && (
        <section className="shell__list">{route.section === "contacts" ? <ContactList activeUserId={route.userId} /> : <ChatList activeRoomId={route.roomId} />}</section>
      )}
      <main className="shell__main">{main}</main>
    </div>
  );
}

function ContactsPlaceholder() {
  return (
    <div className="placeholder-pane">
      <EmptyState
        icon={<Users size={34} />}
        title="Your contacts"
        description="Select a contact to see their profile, start a conversation or view the groups you share."
      />
    </div>
  );
}

function useUnreadTotal(): number {
  const rooms = useRoomSummaries();
  return rooms.reduce((sum, r) => sum + (r.isInvite ? 1 : r.unread), 0);
}

function NavRail({ route }: { route: Route }) {
  const client = useMatrixClient();
  const platform = usePlatform();
  const me = useProfile(client.getUserId());
  const unread = useUnreadTotal();
  return (
    <nav className={`rail ${platform.insetTitleBar ? "rail--inset" : ""}`}>
      <div className="rail__logo">
        <Logo size={38} />
      </div>
      <div className="rail__items">
        {NAV.slice(0, 2).map(({ section, label, icon: Icon }) => (
          <button
            key={section}
            className={`rail__item ${route.section === section ? "is-active" : ""}`}
            onClick={() => navigate({ section })}
            title={label}
            aria-label={label}
          >
            <Icon size={22} />
            {section === "chats" && unread > 0 && <span className="rail__badge">{unread > 99 ? "99+" : unread}</span>}
            <span className="rail__label">{label}</span>
          </button>
        ))}
      </div>
      <div className="rail__bottom">
        <button
          className={`rail__item ${route.section === "settings" ? "is-active" : ""}`}
          onClick={() => navigate({ section: "settings" })}
          title="Settings"
          aria-label="Settings"
        >
          <SettingsIcon size={22} />
          <span className="rail__label">Settings</span>
        </button>
        {me && (
          <Avatar
            mxc={me.avatarMxc}
            name={me.displayName}
            id={me.userId}
            size={38}
            className="rail__me"
            onClick={() => navigate({ section: "settings" })}
            title={`${me.displayName} (${me.userId})`}
          />
        )}
      </div>
    </nav>
  );
}

function CompactShell({ route }: { route: Route }) {
  if (route.section === "chats" && route.roomId) {
    return (
      <div className="compact compact--detail" key={`${route.roomId}-${route.panel ?? ""}`}>
        {route.panel === "info" ? <RoomInfo roomId={route.roomId} /> : <RoomView roomId={route.roomId} />}
      </div>
    );
  }
  if (route.section === "contacts" && route.userId) {
    return (
      <div className="compact compact--detail" key={route.userId}>
        <ContactProfile userId={route.userId} />
      </div>
    );
  }
  return (
    <div className="compact">
      <div className="compact__content">
        {route.section === "contacts" ? <ContactList /> : route.section === "settings" ? <SettingsView /> : <ChatList />}
      </div>
      <TabBar route={route} />
    </div>
  );
}

function TabBar({ route }: { route: Route }) {
  const unread = useUnreadTotal();
  return (
    <nav className="tabbar">
      {NAV.map(({ section, label, icon: Icon }) => (
        <button
          key={section}
          className={`tabbar__item ${route.section === section ? "is-active" : ""}`}
          onClick={() => navigate({ section }, { replace: true })}
        >
          <span className="tabbar__icon">
            <Icon size={23} />
            {section === "chats" && unread > 0 && <span className="tabbar__badge">{unread > 99 ? "99+" : unread}</span>}
          </span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** Android hardware back button / Escape key navigate one level up. */
function useBackButton(route: Route) {
  const routeRef = useRef(route);
  routeRef.current = route;
  useEffect(() => {
    const onBack = (e: Event) => {
      if (navigateUp(routeRef.current)) e.preventDefault();
    };
    window.addEventListener("abea:back", onBack);
    return () => window.removeEventListener("abea:back", onBack);
  }, []);
}

function useNotifications(route: Route) {
  const client = useMatrixClient();
  const platform = usePlatform();
  const routeRef = useRef(route);
  routeRef.current = route;
  const unread = useUnreadTotal();
  const enabled = useNotificationsEnabled();
  const isForeground = () => (platform.isForeground ? platform.isForeground() : document.hasFocus() && !document.hidden);

  // Register / remove the homeserver pusher so notifications also arrive while the app is closed.
  useEffect(() => {
    if (!platform.registerPush && !enabled) return;
    syncPusher(client, platform, enabled).catch((e) => console.warn("Push registration failed", e));
  }, [client, platform, enabled]);

  // Opening a room dismisses its notifications.
  useEffect(() => {
    const roomId = route.roomId;
    if (!roomId || !platform.clearNotifications) return;
    const clear = () => isForeground() && platform.clearNotifications!(roomId);
    clear();
    document.addEventListener("visibilitychange", clear);
    return () => document.removeEventListener("visibilitychange", clear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.roomId, platform]);

  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ABEA` : "ABEA";
    platform.setBadgeCount?.(unread);
  }, [unread, platform]);

  useEffect(() => {
    const onTimeline = (
      ev: MatrixEvent,
      room: Room | undefined,
      toStartOfTimeline: boolean | undefined,
      _removed: boolean,
      data: { liveEvent?: boolean },
    ) => {
      if (!room || toStartOfTimeline || !data?.liveEvent) return;
      if (client.getSyncState() !== SyncState.Syncing) return;
      if (ev.getSender() === client.getUserId()) return;
      if (Date.now() - ev.getTs() > 60_000) return;
      if (!notificationsEnabled()) return;
      const viewing = routeRef.current.roomId === room.roomId && isForeground();
      if (viewing) return;
      const show = () => {
        if (classifyEvent(ev) !== "message") return;
        const actions = client.getPushActionsForEvent(ev);
        if (actions && !actions.notify) return;
        const partner = getDmPartner(client, room);
        const isDm = partner !== null;
        const roomName = getRoomName(client, room, partner);
        const title = isDm ? roomName : `${senderName(ev, room)} · ${roomName}`;
        const body = messagePreview(ev);
        const open = () => {
          window.focus();
          navigate({ section: "chats", roomId: room.roomId });
        };
        if (platform.notify) {
          platform.notify(title, body, open, { roomId: room.roomId, roomName, isDirect: isDm });
        } else if ("Notification" in window && Notification.permission === "granted") {
          const n = new Notification(title, { body, tag: room.roomId });
          n.onclick = open;
        }
      };
      if (ev.isBeingDecrypted() || ev.shouldAttemptDecryption()) {
        ev.once("Event.decrypted" as never, show as never);
      } else {
        show();
      }
    };
    client.on(RoomEvent.Timeline, onTimeline as never);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline as never);
    };
  }, [client, platform]);
}

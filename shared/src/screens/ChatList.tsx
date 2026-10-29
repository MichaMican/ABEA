import { useMemo, useState } from "react";
import { SyncState } from "matrix-js-sdk";
import { Check, Lock, MessageSquarePlus, Users, WifiOff, X } from "lucide-react";
import { useRoomSummaries, useSyncState, type RoomSummary } from "../matrix/hooks";
import { useMatrixClient } from "../matrix/MatrixContext";
import { acceptInvite, leaveRoom } from "../matrix/rooms";
import { navigate } from "../router";
import { Avatar } from "../components/Avatar";
import { Button, EmptyState, IconButton, SearchField } from "../components/ui";
import { useToast } from "../components/Toast";
import { formatListTime } from "../lib/format";
import { NewChatDialog } from "./NewChatDialog";
import { NewGroupDialog } from "./NewGroupDialog";

type Filter = "all" | "direct" | "groups" | "unread";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "direct", label: "Direct" },
  { id: "groups", label: "Groups" },
  { id: "unread", label: "Unread" },
];

export function ChatList({ activeRoomId }: { activeRoomId?: string }) {
  const rooms = useRoomSummaries();
  const sync = useSyncState();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [dialog, setDialog] = useState<"chat" | "group" | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rooms.filter((r) => {
      if (filter === "direct" && !r.isDirect) return false;
      if (filter === "groups" && r.isDirect) return false;
      if (filter === "unread" && !(r.unread > 0 || r.isInvite)) return false;
      if (q && !r.name.toLowerCase().includes(q) && !(r.partnerId ?? "").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rooms, query, filter]);

  const invites = visible.filter((r) => r.isInvite);
  const chats = visible.filter((r) => !r.isInvite);
  const offline = sync === SyncState.Error || sync === SyncState.Reconnecting;

  return (
    <div className="list-pane">
      <header className="list-pane__header">
        <h1>Chats</h1>
        <div className="list-pane__actions">
          <IconButton label="New group" onClick={() => setDialog("group")}>
            <Users size={20} />
          </IconButton>
          <IconButton label="New chat" variant="primary" onClick={() => setDialog("chat")}>
            <MessageSquarePlus size={20} />
          </IconButton>
        </div>
      </header>
      <div className="list-pane__search">
        <SearchField value={query} onChange={setQuery} placeholder="Search chats" />
      </div>
      <div className="chips" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            className={`chip ${filter === f.id ? "is-active" : ""}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>
      {offline && (
        <div className="sync-banner">
          <WifiOff size={16} /> Connection lost — reconnecting…
        </div>
      )}

      <div className="list-pane__scroll">
        {invites.length > 0 && (
          <>
            <div className="list-section-title">Invitations</div>
            {invites.map((r) => (
              <InviteRow key={r.roomId} summary={r} active={r.roomId === activeRoomId} />
            ))}
            {chats.length > 0 && <div className="list-section-title">Chats</div>}
          </>
        )}
        {chats.map((r) => (
          <ChatRow key={r.roomId} summary={r} active={r.roomId === activeRoomId} />
        ))}
        {visible.length === 0 &&
          (rooms.length === 0 ? (
            <EmptyState
              icon={<MessageSquarePlus size={30} />}
              title="No conversations yet"
              description="Start a chat with a friend or create a group to get going."
              action={
                <button className="link-btn" onClick={() => setDialog("chat")}>
                  Start a new chat
                </button>
              }
            />
          ) : (
            <EmptyState title="Nothing found" description="No chats match your search or filter." />
          ))}
      </div>

      <NewChatDialog open={dialog === "chat"} onClose={() => setDialog(null)} />
      <NewGroupDialog open={dialog === "group"} onClose={() => setDialog(null)} />
    </div>
  );
}

function ChatRow({ summary, active }: { summary: RoomSummary; active: boolean }) {
  const unread = summary.unread;
  return (
    <button
      className={`chat-row ${active ? "is-active" : ""} ${unread > 0 ? "is-unread" : ""}`}
      onClick={() => navigate({ section: "chats", roomId: summary.roomId })}
    >
      <div className="chat-row__avatar">
        <Avatar mxc={summary.avatarMxc} name={summary.name} id={summary.partnerId ?? summary.roomId} size={50} />
        {!summary.isDirect && (
          <span className="chat-row__group-badge" title="Group chat">
            <Users size={10} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="chat-row__body">
        <div className="chat-row__top">
          <span className="chat-row__name">
            {summary.name}
            {summary.encrypted && <Lock size={12} className="chat-row__lock" />}
          </span>
          <span className="chat-row__time">{formatListTime(summary.timestamp)}</span>
        </div>
        <div className="chat-row__bottom">
          <span className="chat-row__preview">{summary.preview || "\u00a0"}</span>
          {unread > 0 && (
            <span className={`badge ${summary.highlight > 0 ? "badge--highlight" : ""}`}>{unread > 99 ? "99+" : unread}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function InviteRow({ summary, active }: { summary: RoomSummary; active: boolean }) {
  const client = useMatrixClient();
  const toast = useToast();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const inviter = summary.inviter ? summary.room.getMember(summary.inviter)?.name ?? summary.inviter : null;
  return (
    <div className={`chat-row chat-row--invite ${active ? "is-active" : ""}`}>
      <button className="chat-row__main" onClick={() => navigate({ section: "chats", roomId: summary.roomId })}>
        <div className="chat-row__avatar">
          <Avatar mxc={summary.avatarMxc} name={summary.name} id={summary.partnerId ?? summary.roomId} size={50} />
        </div>
        <div className="chat-row__body">
          <div className="chat-row__top">
            <span className="chat-row__name">{summary.name}</span>
          </div>
          <div className="chat-row__bottom">
            <span className="chat-row__preview">
              {summary.isDirect ? "Wants to chat with you" : inviter ? `${inviter} invited you` : "Invitation"}
            </span>
          </div>
        </div>
      </button>
      <div className="chat-row__invite-actions">
        <Button
          size="sm"
          variant="secondary"
          icon={<X size={16} />}
          loading={busy === "decline"}
          disabled={!!busy}
          onClick={async () => {
            setBusy("decline");
            try {
              await leaveRoom(client, summary.roomId);
            } catch (e) {
              toast.error(e);
              setBusy(null);
            }
          }}
        >
          Decline
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon={<Check size={16} />}
          loading={busy === "accept"}
          disabled={!!busy}
          onClick={async () => {
            setBusy("accept");
            try {
              await acceptInvite(client, summary.room);
              navigate({ section: "chats", roomId: summary.roomId });
            } catch (e) {
              toast.error(e);
            } finally {
              setBusy(null);
            }
          }}
        >
          Accept
        </Button>
      </div>
    </div>
  );
}

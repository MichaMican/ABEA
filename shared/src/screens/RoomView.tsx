import { useEffect, useState, type DragEvent } from "react";
import { KnownMembership, type MatrixEvent, type Room } from "matrix-js-sdk";
import { ArrowLeft, Check, Info, Lock, MessageCircleOff, ShieldCheck, Upload, X } from "lucide-react";
import { useMatrixClient } from "../matrix/MatrixContext";
import { useUserVerification } from "../matrix/security";
import { useRoom, useRoomSummary, useSyncState, useTypingMembers, type RoomSummary } from "../matrix/hooks";
import { acceptInvite, leaveRoom } from "../matrix/rooms";
import { navigate, useRoute } from "../router";
import { Avatar } from "../components/Avatar";
import { Button, EmptyState, IconButton, Spinner } from "../components/ui";
import { useToast } from "../components/Toast";
import { useIsCompact } from "./AppShell";
import { Timeline } from "./room/Timeline";
import { Composer } from "./room/Composer";
import { useUploader } from "./room/useUploader";

export function RoomView({ roomId }: { roomId: string }) {
  const room = useRoom(roomId);
  const summary = useRoomSummary(room);
  const sync = useSyncState();

  if (!room || !summary) {
    return (
      <div className="room room--empty">
        <RoomHeaderBare />
        {sync === null ? (
          <div className="center-fill">
            <Spinner size={28} />
          </div>
        ) : (
          <EmptyState
            icon={<MessageCircleOff size={32} />}
            title="Chat not available"
            description="You may have left this chat, or it no longer exists."
          />
        )}
      </div>
    );
  }
  if (summary.isInvite) return <InvitePreview room={room} summary={summary} />;
  return <ActiveRoom room={room} summary={summary} />;
}

function RoomHeaderBare() {
  const compact = useIsCompact();
  if (!compact) return null;
  return (
    <header className="room-header">
      <IconButton label="Back" onClick={() => navigate({ section: "chats" }, { replace: true })}>
        <ArrowLeft size={22} />
      </IconButton>
    </header>
  );
}

function ActiveRoom({ room, summary }: { room: Room; summary: RoomSummary }) {
  const client = useMatrixClient();
  const [replyTo, setReplyTo] = useState<MatrixEvent | null>(null);
  const [editing, setEditing] = useState<MatrixEvent | null>(null);
  const [dragging, setDragging] = useState(false);
  const { uploads, sendFiles } = useUploader(room);

  useEffect(() => {
    const onEdit = (e: Event) => {
      setReplyTo(null);
      setEditing((e as CustomEvent<MatrixEvent>).detail);
    };
    window.addEventListener("abea:edit", onEdit);
    return () => window.removeEventListener("abea:edit", onEdit);
  }, []);

  const me = client.getUserId() ?? "";
  const canSend = room.currentState.maySendMessage(me);
  const partnerLeft =
    summary.isDirect &&
    summary.partnerId &&
    room.getMember(summary.partnerId)?.membership === KnownMembership.Leave &&
    room.getJoinedMemberCount() <= 1;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void sendFiles(files, replyTo).then(() => setReplyTo(null));
  };

  return (
    <div
      className="room"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <RoomHeader room={room} summary={summary} />
      <Timeline
        room={room}
        summary={summary}
        onReply={(ev) => {
          setEditing(null);
          setReplyTo(ev);
        }}
        onEdit={(ev) => {
          setReplyTo(null);
          setEditing(ev);
        }}
      />
      <Composer
        key={room.roomId}
        room={room}
        replyTo={replyTo}
        editing={editing}
        onClearReply={() => setReplyTo(null)}
        onClearEdit={() => setEditing(null)}
        uploads={uploads}
        onFiles={(files) => {
          void sendFiles(files, replyTo);
          setReplyTo(null);
        }}
        disabledReason={
          partnerLeft
            ? `${summary.name} left this conversation.`
            : !canSend
              ? "You don't have permission to send messages here."
              : null
        }
      />
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay__card">
            <Upload size={34} />
            <span>Drop files to send to {summary.name}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RoomHeader({ room, summary }: { room: Room; summary: RoomSummary }) {
  const compact = useIsCompact();
  const typing = useTypingMembers(room);
  const route = useRoute();
  const partnerTrust = useUserVerification(useMatrixClient(), summary.isDirect && summary.encrypted ? summary.partnerId : null);
  const partnerVerified = !!partnerTrust?.isCrossSigningVerified();
  const infoOpen = route.panel === "info";
  const subtitle =
    typing.length > 0
      ? summary.isDirect
        ? "typing…"
        : `${typing[0]}${typing.length > 1 ? ` +${typing.length - 1}` : ""} typing…`
      : summary.isDirect
        ? summary.partnerId
        : `${summary.memberCount} member${summary.memberCount === 1 ? "" : "s"}`;
  const openInfo = () =>
    navigate({ section: "chats", roomId: room.roomId, panel: infoOpen && !compact ? undefined : "info" }, { replace: !compact });
  return (
    <header className="room-header">
      {compact && (
        <IconButton label="Back" onClick={() => navigate({ section: "chats" }, { replace: true })}>
          <ArrowLeft size={22} />
        </IconButton>
      )}
      <button className="room-header__main" onClick={openInfo}>
        <Avatar mxc={summary.avatarMxc} name={summary.name} id={summary.partnerId ?? summary.roomId} size={42} />
        <span className="room-header__text">
          <span className="room-header__title">
            {summary.name}
            {summary.encrypted &&
              (partnerVerified ? (
                <ShieldCheck size={15} className="room-header__shield" aria-label="Verified" />
              ) : (
                <Lock size={13} className="room-header__lock" />
              ))}
          </span>
          <span className={`room-header__subtitle ${typing.length ? "is-typing" : ""}`}>{subtitle}</span>
        </span>
      </button>
      <div className="room-header__actions">
        <IconButton label="Chat info" onClick={openInfo} active={infoOpen && !compact}>
          <Info size={21} />
        </IconButton>
      </div>
    </header>
  );
}

function InvitePreview({ room, summary }: { room: Room; summary: RoomSummary }) {
  const client = useMatrixClient();
  const toast = useToast();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const compact = useIsCompact();
  const inviterName = summary.inviter ? (room.getMember(summary.inviter)?.name ?? summary.inviter) : null;
  return (
    <div className="room">
      {compact && (
        <header className="room-header">
          <IconButton label="Back" onClick={() => navigate({ section: "chats" }, { replace: true })}>
            <ArrowLeft size={22} />
          </IconButton>
        </header>
      )}
      <div className="invite-preview">
        <Avatar mxc={summary.avatarMxc} name={summary.name} id={summary.partnerId ?? summary.roomId} size={112} />
        <h2>{summary.name}</h2>
        <p>
          {summary.isDirect
            ? `${inviterName ?? summary.name} wants to chat with you.`
            : inviterName
              ? `${inviterName} invited you to join this group.`
              : "You've been invited to join this group."}
        </p>
        {summary.inviter && summary.inviter !== summary.partnerId && <span className="muted">{summary.inviter}</span>}
        <div className="invite-preview__actions">
          <Button
            variant="secondary"
            size="lg"
            icon={<X size={18} />}
            loading={busy === "decline"}
            disabled={!!busy}
            onClick={async () => {
              setBusy("decline");
              try {
                await leaveRoom(client, room.roomId);
                navigate({ section: "chats" }, { replace: true });
              } catch (e) {
                toast.error(e);
                setBusy(null);
              }
            }}
          >
            Decline
          </Button>
          <Button
            size="lg"
            icon={<Check size={18} />}
            loading={busy === "accept"}
            disabled={!!busy}
            onClick={async () => {
              setBusy("accept");
              try {
                await acceptInvite(client, room);
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
    </div>
  );
}

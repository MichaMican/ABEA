import { memo, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type TouchEvent } from "react";
import { EventStatus, EventType, MatrixEvent, MsgType, type Room } from "matrix-js-sdk";
import { AlertCircle, Check, CheckCheck, Clock, CornerUpLeft, MoreHorizontal, SmilePlus } from "lucide-react";
import { Avatar, colorFor } from "../../components/Avatar";
import { useMatrixClient } from "../../matrix/MatrixContext";
import { messagePreview, senderName } from "../../matrix/events";
import { formatTime } from "../../lib/format";
import { navigate } from "../../router";
import type { Anchor } from "../../components/Popover";
import type { LightboxImage } from "../../components/Lightbox";
import { isMediaMessage, MessageContent } from "./MessageContent";

export type ReadState = "sending" | "failed" | "sent" | "read";

export interface MessageProps {
  ev: MatrixEvent;
  room: Room;
  own: boolean;
  first: boolean;
  last: boolean;
  isGroup: boolean;
  readState: ReadState | null;
  /** Bumps whenever the timeline changes so memoised messages pick up reactions/edits. */
  version: number;
  onMenu: (ev: MatrixEvent, anchor: Anchor) => void;
  onReply: (ev: MatrixEvent) => void;
  onToggleReaction: (ev: MatrixEvent, key: string) => void;
  onOpenImage: (img: LightboxImage) => void;
  onJumpTo: (eventId: string) => void;
}

export function getReadState(ev: MatrixEvent, readUpToTs: number): ReadState {
  const status = ev.status;
  if (status === EventStatus.NOT_SENT) return "failed";
  if (status && status !== EventStatus.SENT) return "sending";
  if (ev.getTs() <= readUpToTs) return "read";
  return "sent";
}

export const Message = memo(function Message(props: MessageProps) {
  const { ev, room, own, first, last, isGroup, readState, onMenu, onReply, onToggleReaction, onOpenImage, onJumpTo } = props;
  const client = useMatrixClient();
  const sender = ev.getSender() ?? "";
  const member = room.getMember(sender);
  const name = senderName(ev, room);
  const content = ev.getContent();
  const media = isMediaMessage(ev) && !hasCaption(content);
  const replyId = (ev.getWireContent()?.["m.relates_to"] as { "m.in_reply_to"?: { event_id?: string } } | undefined)?.[
    "m.in_reply_to"
  ]?.event_id ?? (content["m.relates_to"] as { "m.in_reply_to"?: { event_id?: string } } | undefined)?.["m.in_reply_to"]?.event_id;
  const edited = !!ev.replacingEventId() && !ev.isRedacted();
  const emote = content.msgtype === MsgType.Emote ? name : undefined;

  const longPress = useRef<number | null>(null);
  const touchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    const x = t.clientX;
    const y = t.clientY;
    longPress.current = window.setTimeout(() => {
      longPress.current = null;
      navigator.vibrate?.(10);
      onMenu(ev, { x, y });
    }, 450);
  };
  const cancelLongPress = () => {
    if (longPress.current) {
      clearTimeout(longPress.current);
      longPress.current = null;
    }
  };
  const openMenu = (e: ReactMouseEvent) => {
    e.preventDefault();
    onMenu(ev, { x: e.clientX, y: e.clientY });
  };

  const showAvatar = isGroup && !own;
  return (
    <div
      id={`ev-${ev.getId()}`}
      className={`msg ${own ? "msg--own" : "msg--in"} ${first ? "is-first" : ""} ${last ? "is-last" : ""} ${
        readState === "sending" ? "is-pending" : ""
      }`}
    >
      {showAvatar && (
        <div className="msg__avatar">
          {last && (
            <Avatar
              mxc={member?.getMxcAvatarUrl()}
              name={name}
              id={sender}
              size={32}
              onClick={() => navigate({ section: "contacts", userId: sender })}
            />
          )}
        </div>
      )}
      <div className="msg__col">
        {showAvatar && first && (
          <button className="msg__sender" style={{ color: colorFor(sender) }} onClick={() => navigate({ section: "contacts", userId: sender })}>
            {name}
          </button>
        )}
        <div className="msg__row">
          <div
            className={`msg__bubble ${media ? "msg__bubble--media" : ""} ${ev.isRedacted() ? "msg__bubble--redacted" : ""}`}
            onContextMenu={openMenu}
            onTouchStart={touchStart}
            onTouchEnd={cancelLongPress}
            onTouchMove={cancelLongPress}
            onDoubleClick={() => !ev.isRedacted() && onReply(ev)}
          >
            {replyId && <ReplyQuote room={room} eventId={replyId} onJump={onJumpTo} />}
            <MessageContent ev={ev} onOpenImage={onOpenImage} emote={emote} />
            <span className="msg__meta">
              {edited && <span className="msg__edited">edited</span>}
              <time dateTime={new Date(ev.getTs()).toISOString()}>{formatTime(ev.getTs())}</time>
              {own && readState && <StatusIcon state={readState} />}
            </span>
          </div>
          {!ev.isRedacted() && readState !== "sending" && (
            <div className="msg__actions">
              <button
                aria-label="React"
                title="React"
                onClick={(e) => onMenu(ev, { x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() })}
              >
                <SmilePlus size={17} />
              </button>
              <button aria-label="Reply" title="Reply" onClick={() => onReply(ev)}>
                <CornerUpLeft size={17} />
              </button>
              <button
                aria-label="More"
                title="More"
                onClick={(e) => onMenu(ev, { x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() })}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          )}
        </div>
        <Reactions ev={ev} room={room} me={client.getUserId() ?? ""} onToggle={onToggleReaction} />
      </div>
    </div>
  );
});

function hasCaption(content: Record<string, unknown>): boolean {
  const filename = content.filename as string | undefined;
  return !!filename && !!content.body && content.body !== filename;
}

function StatusIcon({ state }: { state: ReadState }) {
  switch (state) {
    case "sending":
      return <Clock size={13} className="msg__status" aria-label="Sending" />;
    case "failed":
      return <AlertCircle size={14} className="msg__status msg__status--failed" aria-label="Failed to send" />;
    case "read":
      return <CheckCheck size={15} className="msg__status msg__status--read" aria-label="Read" />;
    default:
      return <Check size={15} className="msg__status" aria-label="Sent" />;
  }
}

function Reactions({
  ev,
  room,
  me,
  onToggle,
}: {
  ev: MatrixEvent;
  room: Room;
  me: string;
  onToggle: (ev: MatrixEvent, key: string) => void;
}) {
  const id = ev.getId();
  if (!id || ev.isRedacted()) return null;
  const relations = room.relations.getChildEventsForEvent(id, "m.annotation", EventType.Reaction);
  const sorted = relations?.getSortedAnnotationsByKey();
  if (!sorted || sorted.length === 0) return null;
  return (
    <div className="reactions">
      {sorted.map(([key, events]) => {
        const live = [...events].filter((e) => !e.isRedacted());
        if (live.length === 0) return null;
        const mine = live.some((e) => e.getSender() === me);
        const names = live.map((e) => room.getMember(e.getSender() ?? "")?.name ?? e.getSender()).join(", ");
        return (
          <button key={key} className={`reaction ${mine ? "is-mine" : ""}`} onClick={() => onToggle(ev, key)} title={names}>
            <span className="reaction__key">{key}</span>
            <span className="reaction__count">{live.length}</span>
          </button>
        );
      })}
    </div>
  );
}

function useRelatedEvent(room: Room, eventId: string): MatrixEvent | null {
  const client = useMatrixClient();
  const local = room.findEventById(eventId) ?? null;
  const [fetched, setFetched] = useState<MatrixEvent | null>(null);
  useEffect(() => {
    if (local) return;
    let cancelled = false;
    client
      .fetchRoomEvent(room.roomId, eventId)
      .then(async (raw) => {
        const ev = new MatrixEvent(raw);
        if (ev.isEncrypted()) await client.decryptEventIfNeeded(ev);
        if (!cancelled) setFetched(ev);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, room, eventId, local]);
  return local ?? fetched;
}

function ReplyQuote({ room, eventId, onJump }: { room: Room; eventId: string; onJump: (id: string) => void }) {
  const ev = useRelatedEvent(room, eventId);
  const sender = ev?.getSender() ?? "";
  return (
    <button
      className="reply-quote"
      style={{ ["--quote-color" as string]: colorFor(sender || eventId) }}
      onClick={(e) => {
        e.stopPropagation();
        onJump(eventId);
      }}
    >
      <span className="reply-quote__name">{ev ? senderName(ev, room) : "Loading…"}</span>
      <span className="reply-quote__text">{ev ? messagePreview(ev) : "\u00a0"}</span>
    </button>
  );
}

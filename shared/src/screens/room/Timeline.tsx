import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventType, MsgType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { ArrowDown, Copy, CornerUpLeft, Lock, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useMatrixClient } from "../../matrix/MatrixContext";
import { useTimeline, useTypingMembers, type RoomSummary } from "../../matrix/hooks";
import { classifyEvent, describeStateEvent, stripReplyFallback } from "../../matrix/events";
import { formatDaySeparator, isSameDay } from "../../lib/format";
import { QUICK_REACTIONS } from "../../lib/emoji";
import { Avatar } from "../../components/Avatar";
import { Popover, type Anchor } from "../../components/Popover";
import { EmojiPicker } from "../../components/EmojiPicker";
import { Lightbox, type LightboxImage } from "../../components/Lightbox";
import { Spinner } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { useIsCompact } from "../AppShell";
import { getReadState, Message } from "./Message";

type Item =
  | { kind: "day"; key: string; ts: number }
  | { kind: "state"; key: string; text: string }
  | { kind: "msg"; key: string; ev: MatrixEvent; first: boolean; last: boolean };

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function buildItems(events: MatrixEvent[], room: Room): Item[] {
  const items: Item[] = [];
  let prevTs = 0;
  let prevMsg: Extract<Item, { kind: "msg" }> | null = null;
  for (const ev of events) {
    const kind = classifyEvent(ev);
    if (kind === "hidden") continue;
    let text: string | null = null;
    if (kind === "state") {
      text = describeStateEvent(ev, room);
      if (!text) continue;
    }
    const ts = ev.getTs();
    if (!prevTs || !isSameDay(prevTs, ts)) {
      items.push({ kind: "day", key: `day-${ts}`, ts });
      prevMsg = null;
    }
    prevTs = ts;
    const key = ev.getId() ?? ev.getTxnId() ?? `${ts}`;
    if (kind === "state") {
      items.push({ kind: "state", key, text: text! });
      prevMsg = null;
      continue;
    }
    const continues =
      prevMsg !== null &&
      prevMsg.ev.getSender() === ev.getSender() &&
      ts - prevMsg.ev.getTs() < GROUP_WINDOW_MS &&
      prevMsg.ev.getContent().msgtype !== MsgType.Emote;
    if (prevMsg && continues) prevMsg.last = false;
    const item: Extract<Item, { kind: "msg" }> = { kind: "msg", key, ev, first: !continues, last: true };
    items.push(item);
    prevMsg = item;
  }
  return items;
}

/** Timestamp of the newest event any other member has read; own messages up to it show as read. */
function readUpToTs(room: Room, me: string, partnerId: string | null): number {
  const users = partnerId ? [partnerId] : room.getJoinedMembers().map((m) => m.userId).filter((u) => u !== me).slice(0, 100);
  let best = 0;
  for (const u of users) {
    const id = room.getEventReadUpTo(u);
    if (!id) continue;
    const ev = room.findEventById(id);
    if (ev && ev.getTs() > best) best = ev.getTs();
  }
  return best;
}

export function Timeline({
  room,
  summary,
  onReply,
  onEdit,
}: {
  room: Room;
  summary: RoomSummary;
  onReply: (ev: MatrixEvent) => void;
  onEdit: (ev: MatrixEvent) => void;
}) {
  const client = useMatrixClient();
  const toast = useToast();
  const compact = useIsCompact();
  const me = client.getUserId() ?? "";
  const { events, canPaginate, paginating, paginate, version } = useTimeline(room);
  const typing = useTypingMembers(room);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [showJump, setShowJump] = useState(false);
  const [menu, setMenu] = useState<{ ev: MatrixEvent; anchor: Anchor; picker?: boolean } | null>(null);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const [toDelete, setToDelete] = useState<MatrixEvent | null>(null);

  const items = useMemo(() => buildItems(events, room), [events, room]);
  const readTs = useMemo(() => {
    void version;
    return readUpToTs(room, me, summary.isDirect ? summary.partnerId : null);
  }, [room, me, summary.isDirect, summary.partnerId, version]);

  // Load older history when the top sentinel becomes visible.
  useEffect(() => {
    const root = scrollRef.current;
    const target = sentinelRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void paginate();
      },
      { root, rootMargin: "600px 0px 0px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [paginate]);

  // Keep paginating while the content does not yet fill the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || paginating || !canPaginate) return;
    if (root.scrollHeight <= root.clientHeight + 200) void paginate();
  }, [items.length, paginating, canPaginate, paginate]);

  // Jump to bottom when I send something.
  const lastEvent = events[events.length - 1];
  const lastKey = lastEvent ? (lastEvent.getId() ?? lastEvent.getTxnId()) : undefined;
  useEffect(() => {
    if (lastEvent?.getSender() === me) scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [lastKey, lastEvent, me]);

  // Send read receipts while the user is looking at the latest messages.
  const [focused, setFocused] = useState(() => document.hasFocus());
  useEffect(() => {
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  useEffect(() => {
    if (!focused || showJump) return;
    const live = room.getLiveTimeline().getEvents();
    const target = [...live].reverse().find((e) => e.getId() && !e.getId()!.startsWith("~") && !e.isState());
    if (!target || room.hasUserReadEvent(me, target.getId()!)) return;
    client.sendReadReceipt(target).catch(() => undefined);
  }, [client, room, me, focused, showJump, version]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowJump(-el.scrollTop > 400);
  }, []);

  const jumpTo = useCallback((eventId: string) => {
    const el = document.getElementById(`ev-${eventId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("is-flash");
    setTimeout(() => el.classList.remove("is-flash"), 1400);
  }, []);

  const toggleReaction = useCallback(
    async (ev: MatrixEvent, key: string) => {
      const id = ev.getId();
      if (!id) return;
      const rel = room.relations.getChildEventsForEvent(id, "m.annotation", EventType.Reaction);
      const mine = rel
        ?.getRelations()
        .find((r) => r.getSender() === me && !r.isRedacted() && r.getRelation()?.key === key);
      try {
        if (mine?.getId()) {
          await client.redactEvent(room.roomId, mine.getId()!);
        } else {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await client.sendEvent(room.roomId, EventType.Reaction as any, {
            "m.relates_to": { rel_type: "m.annotation", event_id: id, key },
          } as any);
        }
      } catch (e) {
        toast.error(e, "Could not react");
      }
    },
    [client, room, me, toast],
  );

  const onMenu = useCallback((ev: MatrixEvent, anchor: Anchor) => setMenu({ ev, anchor }), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const isGroup = !summary.isDirect;
  return (
    <div className="timeline-wrap">
      <div className="timeline" ref={scrollRef} onScroll={onScroll}>
        <div className="timeline__inner">
          <div ref={sentinelRef} className="timeline__sentinel" />
          {paginating && (
            <div className="timeline__loading">
              <Spinner size={20} />
            </div>
          )}
          {!canPaginate && <ChatStart room={room} summary={summary} />}
          {items.map((item) => {
            if (item.kind === "day") {
              return (
                <div key={item.key} className="day-sep">
                  <span>{formatDaySeparator(item.ts)}</span>
                </div>
              );
            }
            if (item.kind === "state") {
              return (
                <div key={item.key} className="state-line">
                  <span>{item.text}</span>
                </div>
              );
            }
            const own = item.ev.getSender() === me;
            return (
              <Message
                key={item.key}
                ev={item.ev}
                room={room}
                own={own}
                first={item.first}
                last={item.last}
                isGroup={isGroup}
                readState={own ? getReadState(item.ev, readTs) : null}
                version={version}
                onMenu={onMenu}
                onReply={onReply}
                onToggleReaction={toggleReaction}
                onOpenImage={setLightbox}
                onJumpTo={jumpTo}
              />
            );
          })}
          {typing.length > 0 && (
            <div className="typing-row">
              <div className="typing-bubble" aria-label="typing">
                <i />
                <i />
                <i />
              </div>
              <span>
                {typing.length === 1
                  ? `${typing[0]} is typing`
                  : typing.length === 2
                    ? `${typing[0]} and ${typing[1]} are typing`
                    : `${typing.length} people are typing`}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        className={`jump-btn ${showJump ? "is-visible" : ""}`}
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Jump to latest"
      >
        <ArrowDown size={20} />
        {summary.unread > 0 && <span className="badge">{summary.unread}</span>}
      </button>

      <Popover anchor={menu?.anchor ?? null} onClose={closeMenu} sheet={compact} className="msg-menu">
        {menu &&
          (menu.picker ? (
            <EmojiPicker
              onPick={(emoji) => {
                void toggleReaction(menu.ev, emoji);
                closeMenu();
              }}
            />
          ) : (
            <MessageMenu
              ev={menu.ev}
              room={room}
              me={me}
              onReact={(key) => {
                void toggleReaction(menu.ev, key);
                closeMenu();
              }}
              onMoreReactions={() => setMenu({ ...menu, picker: true })}
              onReply={() => {
                onReply(menu.ev);
                closeMenu();
              }}
              onEdit={() => {
                onEdit(menu.ev);
                closeMenu();
              }}
              onCopy={async () => {
                await navigator.clipboard?.writeText(stripReplyFallback(String(menu.ev.getContent().body ?? "")));
                toast.show("Copied to clipboard", "success");
                closeMenu();
              }}
              onDelete={() => {
                setToDelete(menu.ev);
                closeMenu();
              }}
              onRetry={() => {
                client.resendEvent(menu.ev, room).catch((e) => toast.error(e));
                closeMenu();
              }}
              onCancelSend={() => {
                client.cancelPendingEvent(menu.ev);
                closeMenu();
              }}
            />
          ))}
      </Popover>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete message?"
        message="This message will be removed for everyone in the chat."
        confirmLabel="Delete"
        danger
        onClose={() => setToDelete(null)}
        onConfirm={async () => {
          if (!toDelete?.getId()) return;
          try {
            await client.redactEvent(room.roomId, toDelete.getId()!);
          } catch (e) {
            toast.error(e, "Could not delete message");
          }
        }}
      />
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function MessageMenu({
  ev,
  room,
  me,
  onReact,
  onMoreReactions,
  onReply,
  onEdit,
  onCopy,
  onDelete,
  onRetry,
  onCancelSend,
}: {
  ev: MatrixEvent;
  room: Room;
  me: string;
  onReact: (key: string) => void;
  onMoreReactions: () => void;
  onReply: () => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onCancelSend: () => void;
}) {
  const own = ev.getSender() === me;
  const failed = ev.status === "not_sent";
  const content = ev.getContent();
  const isText =
    !ev.isRedacted() &&
    (content.msgtype === MsgType.Text || content.msgtype === MsgType.Notice || content.msgtype === MsgType.Emote);
  const canRedact = !ev.isRedacted() && !!ev.getId() && room.currentState.maySendRedactionForEvent(ev, me);
  const sent = !!ev.getId() && !ev.getId()!.startsWith("~");

  if (failed) {
    return (
      <div className="menu">
        <button className="menu__item" onClick={onRetry}>
          <RotateCcw size={18} /> Retry sending
        </button>
        <button className="menu__item menu__item--danger" onClick={onCancelSend}>
          <X size={18} /> Discard
        </button>
      </div>
    );
  }
  return (
    <div className="menu">
      {sent && !ev.isRedacted() && (
        <div className="menu__reactions">
          {QUICK_REACTIONS.map((r) => (
            <button key={r} onClick={() => onReact(r)} aria-label={`React ${r}`}>
              {r}
            </button>
          ))}
          <button className="menu__more-emoji" onClick={onMoreReactions} aria-label="More reactions">
            +
          </button>
        </div>
      )}
      {sent && !ev.isRedacted() && (
        <button className="menu__item" onClick={onReply}>
          <CornerUpLeft size={18} /> Reply
        </button>
      )}
      {own && isText && sent && (
        <button className="menu__item" onClick={onEdit}>
          <Pencil size={18} /> Edit
        </button>
      )}
      {isText && (
        <button className="menu__item" onClick={onCopy}>
          <Copy size={18} /> Copy text
        </button>
      )}
      {canRedact && (
        <button className="menu__item menu__item--danger" onClick={onDelete}>
          <Trash2 size={18} /> Delete
        </button>
      )}
    </div>
  );
}

function ChatStart({ room, summary }: { room: Room; summary: RoomSummary }) {
  const creator = room.currentState.getStateEvents(EventType.RoomCreate, "")?.getSender();
  const creatorName = creator ? (room.getMember(creator)?.name ?? creator) : null;
  const topic = room.currentState.getStateEvents(EventType.RoomTopic, "")?.getContent().topic as string | undefined;
  return (
    <div className="chat-start">
      <Avatar mxc={summary.avatarMxc} name={summary.name} id={summary.partnerId ?? summary.roomId} size={88} />
      <h3>{summary.name}</h3>
      {summary.isDirect ? (
        <p>This is the beginning of your conversation with {summary.name}.</p>
      ) : (
        <>
          {topic && <p className="chat-start__topic">{topic}</p>}
          <p>{creatorName ? `${creatorName} created this group.` : "This is the beginning of the group."}</p>
        </>
      )}
      {summary.encrypted && (
        <span className="pill pill--success">
          <Lock size={13} /> End-to-end encrypted
        </span>
      )}
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { MsgType, type MatrixEvent, type Room } from "matrix-js-sdk";
import { CornerUpLeft, Paperclip, Pencil, SendHorizontal, Smile, X } from "lucide-react";
import { useMatrixClient } from "../../matrix/MatrixContext";
import { messagePreview, senderName, stripReplyFallback } from "../../matrix/events";
import { Popover, type Anchor } from "../../components/Popover";
import { EmojiPicker } from "../../components/EmojiPicker";
import { IconButton } from "../../components/ui";
import { useToast } from "../../components/Toast";
import { usePlatform } from "../../platform";
import { useIsCompact } from "../AppShell";
import type { UploadItem } from "./useUploader";

const DRAFTS = new Map<string, string>();

export function Composer({
  room,
  replyTo,
  editing,
  onClearReply,
  onClearEdit,
  uploads,
  onFiles,
  disabledReason,
}: {
  room: Room;
  replyTo: MatrixEvent | null;
  editing: MatrixEvent | null;
  onClearReply: () => void;
  onClearEdit: () => void;
  uploads: UploadItem[];
  onFiles: (files: File[]) => void;
  disabledReason?: string | null;
}) {
  const client = useMatrixClient();
  const toast = useToast();
  const platform = usePlatform();
  const compact = useIsCompact();
  const [text, setText] = useState(() => DRAFTS.get(room.roomId) ?? "");
  const [emojiAnchor, setEmojiAnchor] = useState<Anchor | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingRef = useRef<{ active: boolean; last: number }>({ active: false, last: 0 });

  useEffect(() => {
    DRAFTS.set(room.roomId, text);
  }, [room.roomId, text]);

  useEffect(() => {
    if (editing) {
      setText(stripReplyFallback(String(editing.getContent().body ?? "")));
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  }, [editing]);

  useEffect(() => {
    if (replyTo) inputRef.current?.focus();
  }, [replyTo]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  const setTyping = useCallback(
    (isTyping: boolean) => {
      const state = typingRef.current;
      const now = Date.now();
      if (isTyping) {
        if (state.active && now - state.last < 3000) return;
        state.active = true;
        state.last = now;
        client.sendTyping(room.roomId, true, 5000).catch(() => undefined);
      } else if (state.active) {
        state.active = false;
        client.sendTyping(room.roomId, false, 0).catch(() => undefined);
      }
    },
    [client, room.roomId],
  );

  useEffect(() => () => setTyping(false), [setTyping]);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    setTyping(false);
    try {
      if (editing) {
        const id = editing.getId()!;
        onClearEdit();
        if (body === stripReplyFallback(String(editing.getContent().body ?? ""))) return;
        const msgtype = (editing.getContent().msgtype as string) ?? MsgType.Text;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.sendMessage(room.roomId, {
          msgtype,
          body: `* ${body}`,
          "m.new_content": { msgtype, body },
          "m.relates_to": { rel_type: "m.replace", event_id: id },
        } as any);
        return;
      }
      let msgtype: string = MsgType.Text;
      let content = body;
      if (body.startsWith("/me ")) {
        msgtype = MsgType.Emote;
        content = body.slice(4);
      }
      const payload: Record<string, unknown> = { msgtype, body: content };
      if (replyTo?.getId()) {
        payload["m.relates_to"] = { "m.in_reply_to": { event_id: replyTo.getId() } };
        onClearReply();
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.sendMessage(room.roomId, payload as any);
    } catch (e) {
      toast.error(e, "Message could not be sent");
    } finally {
      inputRef.current?.focus();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      // On phones, Enter inserts a newline; the send button sends.
      if (platform.kind === "mobile") return;
      e.preventDefault();
      void send();
    } else if (e.key === "Escape") {
      if (editing) {
        onClearEdit();
        setText("");
      } else if (replyTo) onClearReply();
    } else if (e.key === "ArrowUp" && !text && !editing) {
      const me = client.getUserId();
      const events = room.getLiveTimeline().getEvents();
      const last = [...events]
        .reverse()
        .find((ev) => ev.getSender() === me && ev.getType() === "m.room.message" && !ev.isRedacted() && !ev.isRelation("m.replace"));
      if (last && last.getContent().msgtype === MsgType.Text) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("abea:edit", { detail: last }));
      }
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length) {
      e.preventDefault();
      onFiles(files);
    }
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) {
      setText((t) => t + emoji);
      return;
    }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emoji + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  if (disabledReason) {
    return <div className="composer composer--disabled">{disabledReason}</div>;
  }

  return (
    <div className="composer">
      {uploads.length > 0 && (
        <div className="composer__uploads">
          {uploads.map((u) => (
            <div key={u.id} className="upload-chip">
              {u.previewUrl ? <img src={u.previewUrl} alt="" /> : <Paperclip size={16} />}
              <span className="upload-chip__name">{u.name}</span>
              <span className="upload-chip__bar">
                <i style={{ width: `${Math.round(u.progress * 100)}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
      {(replyTo || editing) && (
        <div className="composer__context">
          {editing ? <Pencil size={18} /> : <CornerUpLeft size={18} />}
          <div className="composer__context-text">
            <span className="composer__context-title">{editing ? "Edit message" : `Reply to ${senderName(replyTo!, room)}`}</span>
            <span className="composer__context-body">{messagePreview((editing ?? replyTo)!)}</span>
          </div>
          <IconButton
            label="Cancel"
            size="sm"
            onClick={() => {
              if (editing) {
                onClearEdit();
                setText("");
              } else onClearReply();
            }}
          >
            <X size={18} />
          </IconButton>
        </div>
      )}
      <div className="composer__bar">
        <IconButton label="Attach file" onClick={() => fileRef.current?.click()}>
          <Paperclip size={21} />
        </IconButton>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length) onFiles(files);
            e.target.value = "";
          }}
        />
        <div className="composer__input">
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            placeholder={room.hasEncryptionStateEvent() ? "Encrypted message" : "Message"}
            onChange={(e) => {
              setText(e.target.value);
              setTyping(e.target.value.length > 0);
            }}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => setTyping(false)}
            aria-label="Message"
          />
          {!compact && (
            <IconButton
              label="Emoji"
              size="sm"
              className="composer__emoji"
              onClick={(e) => setEmojiAnchor({ x: e.clientX, y: e.clientY, rect: e.currentTarget.getBoundingClientRect() })}
            >
              <Smile size={20} />
            </IconButton>
          )}
        </div>
        <button
          className={`send-btn ${text.trim() ? "is-ready" : ""}`}
          onClick={() => void send()}
          disabled={!text.trim()}
          aria-label={editing ? "Save edit" : "Send"}
          title={editing ? "Save" : "Send"}
          onMouseDown={(e) => e.preventDefault()}
        >
          <SendHorizontal size={20} />
        </button>
      </div>
      <Popover anchor={emojiAnchor} onClose={() => setEmojiAnchor(null)} placement="top">
        <EmojiPicker onPick={insertEmoji} />
      </Popover>
    </div>
  );
}

import { EventType, MsgType, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

export type EventKind = "message" | "state" | "hidden";

const STATE_TYPES = new Set<string>([
  EventType.RoomMember,
  EventType.RoomName,
  EventType.RoomTopic,
  EventType.RoomAvatar,
  EventType.RoomCreate,
  EventType.RoomEncryption,
]);

export function getRelType(ev: MatrixEvent): string | undefined {
  const rel = (ev.getWireContent()?.["m.relates_to"] ?? ev.getContent()?.["m.relates_to"]) as
    | { rel_type?: string }
    | undefined;
  return rel?.rel_type;
}

export function classifyEvent(ev: MatrixEvent): EventKind {
  const type = ev.getType();
  if (type === EventType.RoomMessage || type === EventType.RoomMessageEncrypted || type === EventType.Sticker) {
    const rel = getRelType(ev);
    if (rel === "m.replace" || rel === "m.annotation") return "hidden";
    if (ev.isRedacted()) return "message";
    if (type === EventType.RoomMessage && !ev.getContent().msgtype && !ev.getContent().body) return "hidden";
    return "message";
  }
  if (STATE_TYPES.has(type) && ev.isState()) return "state";
  return "hidden";
}

export function senderName(ev: MatrixEvent, room?: Room | null): string {
  const id = ev.getSender() ?? "";
  return ev.sender?.name || room?.getMember(id)?.name || id;
}

function memberName(room: Room | null | undefined, userId: string, fallback?: string): string {
  return room?.getMember(userId)?.name || fallback || userId;
}

export function describeStateEvent(ev: MatrixEvent, room?: Room | null): string | null {
  const content = ev.getContent();
  const prev = ev.getPrevContent();
  const actor = senderName(ev, room);
  switch (ev.getType()) {
    case EventType.RoomMember: {
      const target = ev.getStateKey() ?? "";
      const targetName = (content.displayname as string) || memberName(room, target, prev.displayname as string);
      const membership = content.membership as string;
      const prevMembership = prev.membership as string | undefined;
      if (membership === "join") {
        if (prevMembership === "join") {
          if (content.displayname !== prev.displayname) {
            if (!content.displayname) return `${prev.displayname ?? target} removed their display name`;
            return `${prev.displayname ?? target} is now known as ${content.displayname}`;
          }
          if (content.avatar_url !== prev.avatar_url) {
            return content.avatar_url ? `${targetName} changed their profile picture` : `${targetName} removed their profile picture`;
          }
          return null;
        }
        return `${targetName} joined`;
      }
      if (membership === "invite") return `${actor} invited ${targetName}`;
      if (membership === "leave") {
        if (ev.getSender() === target) {
          return prevMembership === "invite" ? `${targetName} declined the invitation` : `${targetName} left`;
        }
        if (prevMembership === "invite") return `${actor} withdrew ${targetName}'s invitation`;
        if (prevMembership === "ban") return `${actor} unbanned ${targetName}`;
        return `${actor} removed ${targetName}`;
      }
      if (membership === "ban") return `${actor} banned ${targetName}`;
      if (membership === "knock") return `${targetName} asked to join`;
      return null;
    }
    case EventType.RoomName:
      return content.name ? `${actor} renamed the chat to “${content.name}”` : `${actor} removed the chat name`;
    case EventType.RoomTopic:
      return content.topic ? `${actor} changed the topic to “${content.topic}”` : `${actor} removed the topic`;
    case EventType.RoomAvatar:
      return content.url ? `${actor} changed the chat picture` : `${actor} removed the chat picture`;
    case EventType.RoomCreate:
      return `${actor} created the chat`;
    case EventType.RoomEncryption:
      return "Messages in this chat are end-to-end encrypted";
    default:
      return null;
  }
}

/** Removes legacy reply fallbacks ("> <@user> quoted text") from message bodies. */
export function stripReplyFallback(body: string): string {
  const lines = body.split("\n");
  if (!lines[0]?.startsWith("> ")) return body;
  let i = 0;
  while (i < lines.length && lines[i].startsWith(">")) i++;
  if (lines[i] === "") i++;
  return lines.slice(i).join("\n");
}

export function isEncryptedFailure(ev: MatrixEvent): boolean {
  return ev.isDecryptionFailure() || (ev.getType() === EventType.RoomMessageEncrypted && !ev.isBeingDecrypted());
}

export function messagePreview(ev: MatrixEvent): string {
  if (ev.isRedacted()) return "Message deleted";
  if (ev.isBeingDecrypted()) return "Decrypting…";
  if (ev.isDecryptionFailure() || ev.getType() === EventType.RoomMessageEncrypted) return "🔒 Encrypted message";
  if (ev.getType() === EventType.Sticker) return "Sticker";
  const content = ev.getContent();
  const body = stripReplyFallback(String(content.body ?? ""));
  switch (content.msgtype) {
    case MsgType.Image:
      return "📷 Photo";
    case MsgType.Video:
      return "🎬 Video";
    case MsgType.Audio:
      return "🎵 Audio";
    case MsgType.File:
      return `📎 ${body || "File"}`;
    case MsgType.Location:
      return "📍 Location";
    default:
      return body.replace(/\s+/g, " ").trim();
  }
}

export function previewForRoom(client: MatrixClient, room: Room, ev: MatrixEvent, isDirect: boolean): string {
  const kind = classifyEvent(ev);
  if (kind === "state") return describeStateEvent(ev, room) ?? "";
  const text = messagePreview(ev);
  const content = ev.getContent();
  if (content.msgtype === MsgType.Emote) return `* ${senderName(ev, room)} ${text}`;
  if (ev.getSender() === client.getUserId()) return `You: ${text}`;
  if (!isDirect) return `${senderName(ev, room).split(" ")[0]}: ${text}`;
  return text;
}

export function findLastPreviewEvent(room: Room): MatrixEvent | null {
  const events = room.getLiveTimeline().getEvents();
  let fallback: MatrixEvent | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const kind = classifyEvent(ev);
    if (kind === "message") return ev;
    if (!fallback && kind === "state" && describeStateEvent(ev, room)) fallback = ev;
  }
  return fallback;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|\u200d|\ufe0f|\s)+$/u;

export function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 24) return false;
  if (/^[\d#*\s]+$/.test(trimmed)) return false;
  return EMOJI_ONLY.test(trimmed);
}

import {
  EventType,
  KnownMembership,
  Preset,
  type MatrixClient,
  type Room,
  Visibility,
} from "matrix-js-sdk";

export type DirectMap = Record<string, string[]>;

export function getDirectMap(client: MatrixClient): DirectMap {
  return (client.getAccountData(EventType.Direct)?.getContent() as DirectMap | undefined) ?? {};
}

/** Returns the other user of a 1:1 chat, or null when the room is a group chat. */
export function getDmPartner(client: MatrixClient, room: Room): string | null {
  const map = getDirectMap(client);
  for (const [userId, roomIds] of Object.entries(map)) {
    if (Array.isArray(roomIds) && roomIds.includes(room.roomId)) return userId;
  }
  const me = client.getUserId();
  const myMember = me ? room.getMember(me) : null;
  const memberEvent = myMember?.events.member;
  if (memberEvent?.getContent().is_direct && memberEvent.getSender() !== me) {
    return memberEvent.getSender() ?? null;
  }
  if (room.getMyMembership() === KnownMembership.Invite) {
    const inviter = room.getDMInviter();
    if (inviter) return inviter;
  }
  return null;
}

export function isDirectRoom(client: MatrixClient, room: Room): boolean {
  return getDmPartner(client, room) !== null;
}

export async function addDirectRoom(client: MatrixClient, userId: string, roomId: string): Promise<void> {
  const map = { ...getDirectMap(client) };
  const existing = map[userId] ?? [];
  if (existing.includes(roomId)) return;
  map[userId] = [...existing, roomId];
  await client.setAccountData(EventType.Direct, map);
}

/** Finds an existing, still active 1:1 chat with the given user. */
export function findDirectRoom(client: MatrixClient, userId: string): Room | null {
  const map = getDirectMap(client);
  const candidates = (map[userId] ?? [])
    .map((id) => client.getRoom(id))
    .filter((r): r is Room => !!r)
    .filter((r) => {
      const mine = r.getMyMembership();
      if (mine !== KnownMembership.Join && mine !== KnownMembership.Invite) return false;
      const theirs = r.getMember(userId)?.membership;
      return theirs === KnownMembership.Join || theirs === KnownMembership.Invite;
    })
    .sort((a, b) => b.getLastActiveTimestamp() - a.getLastActiveTimestamp());
  return candidates[0] ?? null;
}

export async function startDirectChat(client: MatrixClient, userId: string, encrypted: boolean): Promise<string> {
  const existing = findDirectRoom(client, userId);
  if (existing) return existing.roomId;
  const { room_id } = await client.createRoom({
    preset: Preset.TrustedPrivateChat,
    visibility: Visibility.Private,
    is_direct: true,
    invite: [userId],
    initial_state: encrypted
      ? [{ type: EventType.RoomEncryption, state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }]
      : [],
  });
  await addDirectRoom(client, userId, room_id);
  return room_id;
}

export interface CreateGroupOptions {
  name: string;
  topic?: string;
  avatarUrl?: string;
  invite: string[];
  encrypted: boolean;
}

export async function createGroupChat(client: MatrixClient, opts: CreateGroupOptions): Promise<string> {
  const initialState: { type: string; state_key: string; content: Record<string, unknown> }[] = [];
  if (opts.avatarUrl) initialState.push({ type: EventType.RoomAvatar, state_key: "", content: { url: opts.avatarUrl } });
  if (opts.encrypted) {
    initialState.push({
      type: EventType.RoomEncryption,
      state_key: "",
      content: { algorithm: "m.megolm.v1.aes-sha2" },
    });
  }
  const { room_id } = await client.createRoom({
    preset: Preset.PrivateChat,
    visibility: Visibility.Private,
    name: opts.name.trim(),
    topic: opts.topic?.trim() || undefined,
    invite: opts.invite,
    initial_state: initialState,
  });
  return room_id;
}

/** Accepts an invite and keeps m.direct in sync when the invite was for a 1:1 chat. */
export async function acceptInvite(client: MatrixClient, room: Room): Promise<void> {
  const inviter = room.getDMInviter();
  await client.joinRoom(room.roomId);
  if (inviter) await addDirectRoom(client, inviter, room.roomId);
}

export async function leaveRoom(client: MatrixClient, roomId: string): Promise<void> {
  await client.leave(roomId);
  try {
    await client.forget(roomId);
  } catch {
    // forgetting is best effort
  }
}

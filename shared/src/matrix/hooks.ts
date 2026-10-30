import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClientEvent,
  Direction,
  EventType,
  KnownMembership,
  MatrixEventEvent,
  NotificationCountType,
  RoomEvent,
  RoomMemberEvent,
  RoomStateEvent,
  SyncState,
  UserEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
} from "matrix-js-sdk";
import { useMatrixClient } from "./MatrixContext";
import { findLastPreviewEvent, previewForRoom } from "./events";
import { getDmPartner } from "./rooms";
import { getAllContacts } from "./contacts";

type AnyEmitter = {
  on: (event: string, cb: (...args: unknown[]) => void) => unknown;
  off: (event: string, cb: (...args: unknown[]) => void) => unknown;
};

/**
 * Re-renders the component whenever one of the given client events fires (coalesced per frame).
 * An optional filter lets callers ignore events that are irrelevant to them.
 */
export function useClientVersion(events: string[], filter?: (...args: unknown[]) => boolean): number {
  const client = useMatrixClient() as unknown as AnyEmitter;
  const [version, setVersion] = useState(0);
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const key = events.join("|");

  useEffect(() => {
    let frame = 0;
    const handler = (...args: unknown[]) => {
      if (filterRef.current && !filterRef.current(...args)) return;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };
    const list = key.split("|");
    list.forEach((e) => client.on(e, handler));
    return () => {
      list.forEach((e) => client.off(e, handler));
      if (frame) cancelAnimationFrame(frame);
    };
  }, [client, key]);

  return version;
}

export function useSyncState(): SyncState | null {
  const client = useMatrixClient();
  const [state, setState] = useState<SyncState | null>(client.getSyncState());
  useEffect(() => {
    const onSync = (s: SyncState) => setState(s);
    client.on(ClientEvent.Sync, onSync);
    return () => {
      client.off(ClientEvent.Sync, onSync);
    };
  }, [client]);
  return state;
}

export interface RoomSummary {
  room: Room;
  roomId: string;
  name: string;
  avatarMxc: string | null;
  isDirect: boolean;
  partnerId: string | null;
  isInvite: boolean;
  inviter: string | null;
  preview: string;
  lastEvent: MatrixEvent | null;
  timestamp: number;
  unread: number;
  highlight: number;
  encrypted: boolean;
  memberCount: number;
}

const ROOM_LIST_EVENTS = [
  ClientEvent.Room,
  ClientEvent.DeleteRoom,
  ClientEvent.AccountData,
  RoomEvent.Timeline,
  RoomEvent.Name,
  RoomEvent.MyMembership,
  RoomEvent.Receipt,
  RoomEvent.UnreadNotifications,
  RoomEvent.LocalEchoUpdated,
  RoomEvent.Redaction,
  RoomEvent.TimelineReset,
  RoomStateEvent.Events,
  MatrixEventEvent.Decrypted,
  ClientEvent.Sync,
];

export function getRoomAvatarMxc(client: MatrixClient, room: Room, partnerId: string | null): string | null {
  const own = room.getMxcAvatarUrl();
  if (own) return own;
  if (partnerId) {
    return room.getMember(partnerId)?.getMxcAvatarUrl() ?? client.getUser(partnerId)?.avatarUrl ?? null;
  }
  return null;
}

export function getRoomName(client: MatrixClient, room: Room, partnerId: string | null): string {
  const explicit = room.currentState.getStateEvents(EventType.RoomName, "")?.getContent().name as string | undefined;
  if (explicit) return explicit;
  if (partnerId) {
    return room.getMember(partnerId)?.name ?? client.getUser(partnerId)?.displayName ?? partnerId;
  }
  return room.name || "Unnamed chat";
}

export function summarizeRoom(client: MatrixClient, room: Room): RoomSummary {
  const partnerId = getDmPartner(client, room);
  const isDirect = partnerId !== null;
  const membership = room.getMyMembership();
  const lastEvent = findLastPreviewEvent(room);
  const isInvite = membership === KnownMembership.Invite;
  const me = client.getUserId() ?? "";
  const inviteEvent = isInvite ? room.getMember(me)?.events.member : undefined;
  return {
    room,
    roomId: room.roomId,
    name: getRoomName(client, room, partnerId),
    avatarMxc: getRoomAvatarMxc(client, room, partnerId),
    isDirect,
    partnerId,
    isInvite,
    inviter: inviteEvent?.getSender() ?? null,
    preview: isInvite
      ? isDirect
        ? "wants to chat with you"
        : "Invited you to join"
      : lastEvent
        ? previewForRoom(client, room, lastEvent, isDirect)
        : "",
    lastEvent,
    timestamp: lastEvent?.getTs() ?? room.getLastActiveTimestamp() ?? 0,
    unread: room.getUnreadNotificationCount(NotificationCountType.Total),
    highlight: room.getUnreadNotificationCount(NotificationCountType.Highlight),
    encrypted: room.hasEncryptionStateEvent(),
    memberCount: room.getJoinedMemberCount(),
  };
}

function isListedRoom(client: MatrixClient, room: Room): boolean {
  const membership = room.getMyMembership();
  if (membership !== KnownMembership.Join && membership !== KnownMembership.Invite) return false;
  if (room.isSpaceRoom()) return false;
  const tombstone = room.currentState.getStateEvents(EventType.RoomTombstone, "");
  if (tombstone) {
    const successor = client.getRoom(tombstone.getContent().replacement_room as string);
    if (successor?.getMyMembership() === KnownMembership.Join) return false;
  }
  return true;
}

export function useRoomSummaries(): RoomSummary[] {
  const client = useMatrixClient();
  const version = useClientVersion(ROOM_LIST_EVENTS);
  return useMemo(() => {
    void version;
    return client
      .getRooms()
      .filter((r) => isListedRoom(client, r))
      .map((r) => summarizeRoom(client, r))
      .sort((a, b) => {
        if (a.isInvite !== b.isInvite) return a.isInvite ? -1 : 1;
        return b.timestamp - a.timestamp;
      });
  }, [client, version]);
}

export function useRoom(roomId: string | null | undefined): Room | null {
  const client = useMatrixClient();
  const version = useClientVersion(
    [ClientEvent.Room, ClientEvent.DeleteRoom, RoomEvent.MyMembership, RoomEvent.Name, RoomStateEvent.Events, ClientEvent.AccountData],
    (...args) => {
      const first = args[0] as { roomId?: string; getRoomId?: () => string } | undefined;
      if (!first) return true;
      const id = first.roomId ?? first.getRoomId?.();
      return !id || id === roomId;
    },
  );
  return useMemo(() => {
    void version;
    return roomId ? client.getRoom(roomId) : null;
  }, [client, roomId, version]);
}

export function useRoomSummary(room: Room | null): RoomSummary | null {
  const client = useMatrixClient();
  const version = useClientVersion(ROOM_LIST_EVENTS);
  return useMemo(() => {
    void version;
    return room ? summarizeRoom(client, room) : null;
  }, [client, room, version]);
}

export interface TimelineState {
  events: MatrixEvent[];
  canPaginate: boolean;
  paginating: boolean;
  paginate: () => Promise<void>;
  version: number;
}

export function useTimeline(room: Room | null): TimelineState {
  const client = useMatrixClient();
  const roomId = room?.roomId;
  const version = useClientVersion(
    [
      RoomEvent.Timeline,
      RoomEvent.LocalEchoUpdated,
      RoomEvent.Redaction,
      RoomEvent.TimelineReset,
      RoomEvent.Receipt,
      MatrixEventEvent.Decrypted,
      MatrixEventEvent.Replaced,
      RoomStateEvent.Members,
      RoomMemberEvent.Name,
    ],
    (...args) => {
      for (const a of args) {
        if (a && typeof a === "object") {
          const candidate = a as { roomId?: string; getRoomId?: () => string | undefined };
          const id = typeof candidate.getRoomId === "function" ? candidate.getRoomId() : candidate.roomId;
          if (id) return id === roomId;
        }
      }
      return true;
    },
  );
  const [paginating, setPaginating] = useState(false);
  const [paginationVersion, setPaginationVersion] = useState(0);

  const events = useMemo(() => {
    void version;
    void paginationVersion;
    if (!room) return [];
    return [...room.getLiveTimeline().getEvents(), ...room.getPendingEvents()];
  }, [room, version, paginationVersion]);

  const canPaginate = useMemo(() => {
    void version;
    void paginationVersion;
    if (!room) return false;
    return room.getLiveTimeline().getPaginationToken(Direction.Backward) !== null;
  }, [room, version, paginationVersion]);

  const busy = useRef(false);
  const paginate = useCallback(async () => {
    if (!room || busy.current) return;
    if (room.getLiveTimeline().getPaginationToken(Direction.Backward) === null) return;
    busy.current = true;
    setPaginating(true);
    try {
      await client.paginateEventTimeline(room.getLiveTimeline(), { backwards: true, limit: 40 });
    } catch (e) {
      console.warn("Pagination failed", e);
    } finally {
      busy.current = false;
      setPaginating(false);
      setPaginationVersion((v) => v + 1);
    }
  }, [client, room]);

  return { events, canPaginate, paginating, paginate, version: version + paginationVersion };
}

export function useTypingMembers(room: Room | null): string[] {
  const client = useMatrixClient();
  const version = useClientVersion([RoomMemberEvent.Typing]);
  return useMemo(() => {
    void version;
    if (!room) return [];
    const me = client.getUserId();
    return room
      .getMembers()
      .filter((m) => m.typing && m.userId !== me)
      .map((m) => m.name);
  }, [client, room, version]);
}

export interface Profile {
  userId: string;
  displayName: string;
  avatarMxc: string | null;
}

const profileCache = new Map<string, { displayname?: string; avatar_url?: string } | null>();
const profileRequests = new Map<string, Promise<void>>();

const profileListeners = new Set<(userId: string) => void>();

/** Drops the cached profile and makes every mounted `useProfile` for that user refetch. */
export function invalidateProfile(userId: string): void {
  profileCache.delete(userId);
  profileRequests.delete(userId);
  profileListeners.forEach((l) => l(userId));
}

export function useProfile(userId: string | null | undefined): Profile | null {
  const client = useMatrixClient();
  const [fetchVersion, setFetchVersion] = useState(0);
  const [invalidation, setInvalidation] = useState(0);
  useEffect(() => {
    const listener = (id: string) => id === userId && setInvalidation((v) => v + 1);
    profileListeners.add(listener);
    return () => {
      profileListeners.delete(listener);
    };
  }, [userId]);
  const version = useClientVersion([UserEvent.DisplayName, UserEvent.AvatarUrl, RoomStateEvent.Members], (...args) => {
    const first = args[1] as { userId?: string } | undefined;
    const user = args[0] as { userId?: string } | undefined;
    return user?.userId === userId || first?.userId === userId;
  });

  useEffect(() => {
    if (!userId) return;
    if (profileCache.has(userId)) return;
    let request = profileRequests.get(userId);
    if (!request) {
      request = client
        .getProfileInfo(userId)
        .then((info) => {
          profileCache.set(userId, info as { displayname?: string; avatar_url?: string });
        })
        .catch(() => {
          profileCache.set(userId, null);
        });
      profileRequests.set(userId, request);
    }
    let cancelled = false;
    request.then(() => !cancelled && setFetchVersion((v) => v + 1));
    return () => {
      cancelled = true;
    };
  }, [client, userId, invalidation]);

  return useMemo(() => {
    void version;
    void fetchVersion;
    if (!userId) return null;
    const fetched = profileCache.get(userId);
    const user = client.getUser(userId);
    let memberName: string | undefined;
    let memberAvatar: string | undefined;
    if (!fetched) {
      for (const room of client.getRooms()) {
        const m = room.getMember(userId);
        if (m) {
          memberName = m.rawDisplayName || undefined;
          memberAvatar = m.getMxcAvatarUrl() ?? undefined;
          break;
        }
      }
    }
    const isMe = userId === client.getUserId();
    // The SDK initialises User.displayName with the raw user ID, which is not a real name.
    const userName = user?.displayName && user.displayName !== userId ? user.displayName : undefined;
    return {
      userId,
      displayName:
        (isMe ? userName : undefined) ||
        fetched?.displayname ||
        userName ||
        memberName ||
        userId.replace(/^@/, "").split(":")[0],
      avatarMxc: (isMe ? user?.avatarUrl : undefined) || fetched?.avatar_url || user?.avatarUrl || memberAvatar || null,
    };
  }, [client, userId, version, fetchVersion]);
}

export function useContacts(): string[] {
  const client = useMatrixClient();
  const version = useClientVersion([ClientEvent.AccountData, ClientEvent.Room, RoomEvent.MyMembership]);
  return useMemo(() => {
    void version;
    return getAllContacts(client);
  }, [client, version]);
}

export function useAccountDataVersion(): number {
  return useClientVersion([ClientEvent.AccountData]);
}

export function useIgnoredUsers(): string[] {
  const client = useMatrixClient();
  const version = useAccountDataVersion();
  return useMemo(() => {
    void version;
    return client.getIgnoredUsers();
  }, [client, version]);
}

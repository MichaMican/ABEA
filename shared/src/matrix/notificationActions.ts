import { EventType, MatrixEvent, MsgType, type MatrixClient, type Room } from "matrix-js-sdk";
import type { ChatNotificationAction } from "../platform";

/** Ignore optimistic receipts: a failed read-marker request must not dismiss a notification. */
export function notificationWasRead(room: Room, userId: string, eventId: string): boolean {
  const receipts = [
    room.getEventReadUpTo(userId, true),
    room.getAccountData(EventType.FullyRead)?.getContent().event_id as string | undefined,
  ];
  return receipts.some((readId) => {
    if (!readId) return false;
    if (readId === eventId) return true;
    const order = room.getUnfilteredTimelineSet().compareEventOrdering(readId, eventId);
    return order !== null && order >= 0;
  });
}

export async function markRoomRead(client: MatrixClient, roomId: string, eventId: string): Promise<void> {
  const room = client.getRoom(roomId);
  const userId = client.getUserId();
  if (!room || !userId) throw new Error("The chat is not available. Open ABEA and sync before trying again.");
  if (notificationWasRead(room, userId, eventId)) return;
  await client.setRoomReadMarkersHttpRequest(roomId, eventId, eventId);
  // Only update local state after the server accepts the read marker.
  room.addReceipt(new MatrixEvent({
    type: EventType.Receipt,
    room_id: roomId,
    content: { [eventId]: { "m.read": { [userId]: { ts: Date.now() } } } },
  }));
}

export async function performNotificationAction(client: MatrixClient, action: ChatNotificationAction): Promise<void> {
  if (client.getUserId() !== action.userId) throw new Error("This notification belongs to a different account.");
  const room = client.getRoom(action.roomId);
  if (!room || room.getMyMembership() !== "join") throw new Error("You are no longer a member of this chat.");
  if (action.type === "reply") {
    if (!action.reply?.trim()) throw new Error("Enter a message to reply.");
    if (room.hasEncryptionStateEvent() && !client.getCrypto()) {
      throw new Error("Encryption is not ready. Open ABEA to send this reply securely.");
    }
    // Reuse a transaction id if Android redelivers the action after a restart.
    await client.sendMessage(action.roomId, { msgtype: MsgType.Text, body: action.reply }, `notification-${action.id}`);
    // Sending succeeded. A later receipt failure must not make a retry send the message again.
    try {
      await markRoomRead(client, action.roomId, action.eventId);
    } catch (error) {
      console.warn("Reply sent, but its read marker could not be updated", error);
    }
  } else {
    await markRoomRead(client, action.roomId, action.eventId);
  }
}

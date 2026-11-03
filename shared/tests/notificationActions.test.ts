import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createClient, EventType, MatrixEvent, Room, RoomEvent } from "matrix-js-sdk";
import { markRoomRead, notificationWasRead, performNotificationAction } from "../src/matrix/notificationActions.ts";

const userId = "@me:example.org";
const roomId = "!chat:example.org";
const action = { id: "action-123", userId, roomId, eventId: "$one", type: "read" as const };

function setup() {
  const client = createClient({ baseUrl: "https://example.org", userId, deviceId: "TEST" });
  const room = new Room(roomId, client, userId);
  client.store.storeRoom(room);
  mock.method(room, "getMyMembership", () => "join");
  const events = ["$one", "$two"].map((id, index) => new MatrixEvent({
    type: EventType.RoomMessage,
    room_id: roomId,
    event_id: id,
    sender: "@other:example.org",
    origin_server_ts: index + 1,
    content: { msgtype: "m.text", body: id },
  }));
  for (const event of events) room.getUnfilteredTimelineSet().addLiveEvent(event, { addToState: false });
  const read = mock.method(client, "setRoomReadMarkersHttpRequest", async () => ({}));
  const send = mock.method(client, "sendMessage", async () => ({ event_id: "$reply" }));
  return { client, room, read, send };
}

function receipt(room: Room, eventId: string, reader = userId, synthetic = false) {
  room.addReceipt(new MatrixEvent({
    type: EventType.Receipt, room_id: roomId,
    content: { [eventId]: { "m.read": { [reader]: { ts: Date.now() } } } },
  }), synthetic);
}

test("an unread or unknown event is not cleared, even when the room has no notification count", () => {
  const { room } = setup();
  assert.equal(notificationWasRead(room, userId, "$one"), false);
  assert.equal(notificationWasRead(room, userId, "$missing"), false);
});

test("a confirmed receipt from this user clears only the events up to it", () => {
  const { room } = setup();
  receipt(room, "$one");
  assert.equal(notificationWasRead(room, userId, "$one"), true);
  assert.equal(notificationWasRead(room, userId, "$two"), false);
  receipt(room, "$two");
  assert.equal(notificationWasRead(room, userId, "$one"), true);
});

test("another member's receipt does not clear our notification", () => {
  const { room } = setup();
  receipt(room, "$two", "@other:example.org");
  assert.equal(notificationWasRead(room, userId, "$one"), false);
});

test("optimistic receipts cannot dismiss a notification before a successful server response", () => {
  const { room } = setup();
  receipt(room, "$two", userId, true);
  assert.equal(notificationWasRead(room, userId, "$one"), false);
});

test("a fully-read marker synced from another device also dismisses covered messages", () => {
  const { room } = setup();
  room.addAccountData([new MatrixEvent({
    type: EventType.FullyRead,
    content: { event_id: "$two" },
  })]);
  assert.equal(notificationWasRead(room, userId, "$one"), true);
  assert.equal(notificationWasRead(room, userId, "$two"), true);
});

test("mark as read posts both markers and emits a confirmed receipt after success", async () => {
  const { client, room, read } = setup();
  let emitted = false;
  room.on(RoomEvent.Receipt, () => { emitted = true; });
  await markRoomRead(client, roomId, "$one");
  assert.deepEqual(read.mock.calls[0].arguments, [roomId, "$one", "$one"]);
  assert.equal(emitted, true);
  assert.equal(notificationWasRead(room, userId, "$one"), true);
  assert.equal(notificationWasRead(room, userId, "$two"), false);
});

test("a failed read request leaves the notification unread", async () => {
  const { client, room, read } = setup();
  read.mock.mockImplementation(async () => { throw new Error("Offline"); });
  await assert.rejects(markRoomRead(client, roomId, "$one"), /Offline/);
  assert.equal(notificationWasRead(room, userId, "$one"), false);
});

test("marking an older notification never moves a newer read marker backwards", async () => {
  const { client, room, read } = setup();
  receipt(room, "$two");
  await performNotificationAction(client, action);
  assert.equal(read.mock.callCount(), 0);
});

test("reply goes through the Matrix SDK with a stable transaction id, then marks the notified event read", async () => {
  const { client, room, read, send } = setup();
  await performNotificationAction(client, { ...action, type: "reply", reply: "Hello!" });
  assert.deepEqual(send.mock.calls[0].arguments, [roomId, { msgtype: "m.text", body: "Hello!" }, "notification-action-123"]);
  assert.equal(read.mock.callCount(), 1);
  assert.equal(notificationWasRead(room, userId, "$one"), true);
  assert.equal(notificationWasRead(room, userId, "$two"), false);
});

test("reply failures are surfaced and do not mark messages read", async () => {
  const { client, send, read } = setup();
  send.mock.mockImplementation(async () => { throw new Error("Could not send"); });
  await assert.rejects(performNotificationAction(client, { ...action, type: "reply", reply: "Hello!" }), /Could not send/);
  assert.equal(read.mock.callCount(), 0);
});

test("encrypted reply is blocked when crypto is unavailable; plaintext is never sent", async () => {
  const { client, room, send } = setup();
  mock.method(room, "hasEncryptionStateEvent", () => true);
  await assert.rejects(performNotificationAction(client, { ...action, type: "reply", reply: "Secret" }), /Encryption is not ready/);
  assert.equal(send.mock.callCount(), 0);
});

test("blank replies, signed-out accounts and left rooms are rejected", async () => {
  const { client, room, send, read } = setup();
  await assert.rejects(performNotificationAction(client, { ...action, type: "reply", reply: "  " }), /Enter a message/);
  await assert.rejects(performNotificationAction(client, { ...action, userId: "@previous:example.org" }), /different account/);
  mock.method(room, "getMyMembership", () => "leave");
  await assert.rejects(performNotificationAction(client, action), /no longer a member/);
  assert.equal(send.mock.callCount(), 0);
  assert.equal(read.mock.callCount(), 0);
});

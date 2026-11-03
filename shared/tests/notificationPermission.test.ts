import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { NotificationPermissionState, PlatformAdapter } from "../src/platform.ts";
import {
  checkNotificationPermission,
  NOTIFICATIONS_KEY,
  PERMISSION_PROMPTED_KEY,
  promptForNotificationPermissionOnce,
  requestNotificationPermission,
  subscribeNotificationPermission,
} from "../src/matrix/notifications.ts";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  },
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** A native (mobile) adapter whose dialog turns `state` into `answer`. */
function nativePlatform(state: NotificationPermissionState, answer: NotificationPermissionState = "granted") {
  const permission = {
    check: mock.fn(async () => state),
    request: mock.fn(async () => (state = answer)),
  };
  const platform: PlatformAdapter = { kind: "mobile", os: "android", notificationPermission: permission };
  return { platform, permission };
}

function freshInstall() {
  storage.clear();
}

test("first launch shows the permission dialog exactly once", async () => {
  freshInstall();
  const { platform, permission } = nativePlatform("prompt");
  assert.equal(await promptForNotificationPermissionOnce(platform), "granted");
  assert.equal(await promptForNotificationPermissionOnce(platform), null);
  assert.equal(permission.request.mock.callCount(), 1);
  assert.equal(storage.get(PERMISSION_PROMPTED_KEY), "1");
});

test("a dismissed first-launch dialog is not shown again on the next launch", async () => {
  freshInstall();
  const { platform, permission } = nativePlatform("prompt", "prompt");
  assert.equal(await promptForNotificationPermissionOnce(platform), "prompt");
  assert.equal(await promptForNotificationPermissionOnce(platform), null);
  assert.equal(permission.request.mock.callCount(), 1);
});

test("no dialog when the permission was already granted or denied", async () => {
  for (const state of ["granted", "denied"] as const) {
    freshInstall();
    const { platform, permission } = nativePlatform(state);
    assert.equal(await promptForNotificationPermissionOnce(platform), state);
    assert.equal(permission.request.mock.callCount(), 0);
  }
});

test("no dialog when notifications were turned off in ABEA", async () => {
  freshInstall();
  storage.set(NOTIFICATIONS_KEY, "0");
  const { platform, permission } = nativePlatform("prompt");
  assert.equal(await promptForNotificationPermissionOnce(platform), null);
  assert.equal(permission.check.mock.callCount(), 0);
  assert.equal(permission.request.mock.callCount(), 0);
});

test("browsers are never prompted without a click", async () => {
  freshInstall();
  assert.equal(await promptForNotificationPermissionOnce({ kind: "web", os: "web" }), null);
  assert.equal(storage.has(PERMISSION_PROMPTED_KEY), false);
});

test("concurrent requests (first launch and banner) share a single dialog", async () => {
  const answer = deferred<NotificationPermissionState>();
  const request = mock.fn(() => answer.promise);
  const platform: PlatformAdapter = {
    kind: "mobile",
    os: "android",
    notificationPermission: { check: async () => "prompt", request },
  };
  const first = requestNotificationPermission(platform);
  const second = requestNotificationPermission(platform);
  answer.resolve("granted");
  assert.deepEqual(await Promise.all([first, second]), ["granted", "granted"]);
  assert.equal(request.mock.callCount(), 1);
  // Once answered, the banner can ask again.
  assert.equal(await requestNotificationPermission(platform), "granted");
  assert.equal(request.mock.callCount(), 2);
});

test("a check that started before the dialog was answered cannot overwrite its result", async () => {
  const staleCheck = deferred<NotificationPermissionState>();
  let checks = 0;
  const platform: PlatformAdapter = {
    kind: "mobile",
    os: "android",
    notificationPermission: {
      check: () => (checks++ === 0 ? staleCheck.promise : Promise.resolve("granted")),
      request: async () => "granted",
    },
  };
  const published: NotificationPermissionState[] = [];
  const unsubscribe = subscribeNotificationPermission((state) => published.push(state));
  const check = checkNotificationPermission(platform);
  await requestNotificationPermission(platform);
  staleCheck.resolve("prompt");
  await check;
  await checkNotificationPermission(platform);
  unsubscribe();
  assert.deepEqual(published, ["granted", "granted"]);
});

test("a failing permission check counts as not allowed", async () => {
  const platform: PlatformAdapter = {
    kind: "mobile",
    os: "android",
    notificationPermission: { check: async () => Promise.reject(new Error("bridge")), request: async () => "granted" },
  };
  assert.equal(await checkNotificationPermission(platform), "denied");
});

test("desktop apps can always notify", async () => {
  const platform: PlatformAdapter = { kind: "desktop", os: "mac", notify: () => undefined };
  assert.equal(await checkNotificationPermission(platform), "granted");
  assert.equal(await requestNotificationPermission(platform), "granted");
});

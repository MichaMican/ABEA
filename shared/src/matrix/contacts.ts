import { KnownMembership, type MatrixClient } from "matrix-js-sdk";
import { getDirectMap } from "./rooms";

/**
 * Matrix has no built-in address book. ABEA stores saved contacts in private, per-account
 * account data so they roam between all of the user's devices.
 */
export const CONTACTS_EVENT = "app.abea.contacts";

interface ContactsContent {
  users?: Record<string, { added_ts: number }>;
}

function readContacts(client: MatrixClient): Record<string, { added_ts: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ev = client.getAccountData(CONTACTS_EVENT as any);
  return ((ev?.getContent() as ContactsContent | undefined)?.users ?? {}) as Record<string, { added_ts: number }>;
}

export function getSavedContacts(client: MatrixClient): string[] {
  return Object.keys(readContacts(client));
}

export function isSavedContact(client: MatrixClient, userId: string): boolean {
  return userId in readContacts(client);
}

export async function addContact(client: MatrixClient, userId: string): Promise<void> {
  const users = { ...readContacts(client), [userId]: { added_ts: Date.now() } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.setAccountData(CONTACTS_EVENT as any, { users } as any);
}

export async function removeContact(client: MatrixClient, userId: string): Promise<void> {
  const users = { ...readContacts(client) };
  delete users[userId];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await client.setAccountData(CONTACTS_EVENT as any, { users } as any);
}

/** Saved contacts plus everyone the user has a 1:1 chat with. */
export function getAllContacts(client: MatrixClient): string[] {
  const me = client.getUserId();
  const ids = new Set<string>(getSavedContacts(client));
  const map = getDirectMap(client);
  for (const [userId, roomIds] of Object.entries(map)) {
    const active = (roomIds ?? []).some((id) => {
      const membership = client.getRoom(id)?.getMyMembership();
      return membership === KnownMembership.Join || membership === KnownMembership.Invite;
    });
    if (active) ids.add(userId);
  }
  if (me) ids.delete(me);
  return [...ids];
}

export function isValidUserId(value: string): boolean {
  return /^@[^:\s]+:[^\s]+$/.test(value.trim());
}

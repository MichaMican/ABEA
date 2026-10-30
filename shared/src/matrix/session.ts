import {
  AutoDiscovery,
  createClient,
  IndexedDBStore,
  type MatrixClient,
  PendingEventOrdering,
} from "matrix-js-sdk";
import { clearSecretKeyCache, makeCryptoCallbacks } from "./security";

export interface StoredSession {
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
}

const SESSION_KEY = "abea.session";
const DB_NAME = "abea-sync";
const CRYPTO_PREFIX = "abea-crypto";

export function loadSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (!parsed.accessToken || !parsed.userId || !parsed.homeserverUrl) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/**
 * Resolve the user's input ("matrix.org", "https://matrix.example.com", "@me:example.com")
 * into a client-server API base URL using .well-known discovery when possible.
 */
export async function resolveHomeserver(input: string): Promise<string> {
  let value = input.trim();
  if (!value) throw new Error("Please enter a homeserver.");
  if (value.startsWith("@") && value.includes(":")) value = value.slice(value.indexOf(":") + 1);

  if (/^https?:\/\//i.test(value)) {
    const url = value.replace(/\/+$/, "");
    if (await isHomeserver(url)) return url;
    const host = new URL(url).host;
    const discovered = await discover(host);
    if (discovered) return discovered;
    throw new Error(`Could not reach a Matrix homeserver at ${url}.`);
  }

  const discovered = await discover(value);
  if (discovered) return discovered;
  for (const candidate of [`https://${value}`, `http://${value}`]) {
    if (await isHomeserver(candidate)) return candidate;
  }
  throw new Error(`Could not find a Matrix homeserver for “${value}”.`);
}

async function discover(domain: string): Promise<string | null> {
  try {
    const config = await AutoDiscovery.findClientConfig(domain);
    const hs = config["m.homeserver"];
    if (hs?.state === AutoDiscovery.SUCCESS && hs.base_url) return hs.base_url.replace(/\/+$/, "");
  } catch {
    // fall through
  }
  return null;
}

async function isHomeserver(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/_matrix/client/versions`);
    if (!res.ok) return false;
    const json = await res.json();
    return Array.isArray(json?.versions);
  } catch {
    return false;
  }
}

export interface LoginFlows {
  password: boolean;
  sso: boolean;
  identityProviders: { id: string; name: string }[];
}

export async function fetchLoginFlows(baseUrl: string): Promise<LoginFlows> {
  const client = createClient({ baseUrl });
  const { flows } = await client.loginFlows();
  const result: LoginFlows = { password: false, sso: false, identityProviders: [] };
  for (const flow of flows) {
    if (flow.type === "m.login.password") result.password = true;
    if (flow.type === "m.login.sso") {
      result.sso = true;
      const idps = (flow as { identity_providers?: { id: string; name: string }[] }).identity_providers;
      if (idps) result.identityProviders = idps.map((p) => ({ id: p.id, name: p.name }));
    }
  }
  return result;
}

export async function loginWithPassword(baseUrl: string, username: string, password: string): Promise<StoredSession> {
  const client = createClient({ baseUrl });
  const user = username.trim();
  const res = await client.loginRequest({
    type: "m.login.password",
    identifier: { type: "m.id.user", user },
    password,
    initial_device_display_name: deviceDisplayName(),
  });
  return { homeserverUrl: baseUrl, userId: res.user_id, deviceId: res.device_id, accessToken: res.access_token };
}

export async function loginWithLoginToken(baseUrl: string, token: string): Promise<StoredSession> {
  const client = createClient({ baseUrl });
  const res = await client.loginRequest({
    type: "m.login.token",
    token,
    initial_device_display_name: deviceDisplayName(),
  });
  return { homeserverUrl: baseUrl, userId: res.user_id, deviceId: res.device_id, accessToken: res.access_token };
}

export function getSsoRedirectUrl(baseUrl: string, redirectUrl: string, idpId?: string): string {
  const client = createClient({ baseUrl });
  return client.getSsoLoginUrl(redirectUrl, "sso", idpId);
}

/**
 * Registers a new account using the simple `m.login.dummy` flow.
 * Servers that require captchas, e-mail or terms will reject this; the error is surfaced to the user.
 */
export async function register(baseUrl: string, username: string, password: string): Promise<StoredSession> {
  const client = createClient({ baseUrl });
  const body = {
    username: username.trim().replace(/^@/, "").split(":")[0],
    password,
    initial_device_display_name: deviceDisplayName(),
  };
  let session: string | undefined;
  try {
    const res = await client.registerRequest(body);
    return toSession(baseUrl, res);
  } catch (e) {
    const data = (e as { data?: { session?: string; flows?: { stages: string[] }[] } }).data;
    if (!data?.flows) throw e;
    session = data.session;
    const dummyOnly = data.flows.some((f) => f.stages.length === 1 && f.stages[0] === "m.login.dummy");
    if (!dummyOnly) {
      throw new Error("This homeserver requires registration through its website (captcha, e-mail or terms).");
    }
  }
  const res = await client.registerRequest({ ...body, auth: { type: "m.login.dummy", session } });
  return toSession(baseUrl, res);
}

function toSession(baseUrl: string, res: { user_id: string; device_id?: string; access_token?: string }): StoredSession {
  if (!res.access_token || !res.device_id) throw new Error("The server did not return a session.");
  return { homeserverUrl: baseUrl, userId: res.user_id, deviceId: res.device_id, accessToken: res.access_token };
}

function deviceDisplayName(): string {
  const ua = navigator.userAgent;
  const platform = /Electron/.test(ua)
    ? "Desktop"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : "Web";
  return `ABEA ${platform}`;
}

export interface StartedClient {
  client: MatrixClient;
  cryptoEnabled: boolean;
}

export async function createStartedClient(session: StoredSession): Promise<StartedClient> {
  let current: MatrixClient | null = null;
  const cryptoCallbacks = makeCryptoCallbacks(() => current);
  const makeClient = (store?: IndexedDBStore) =>
    (current = createClient({
      baseUrl: session.homeserverUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
      timelineSupport: true,
      useAuthorizationHeader: true,
      cryptoCallbacks,
      ...(store ? { store } : {}),
    }));

  let client: MatrixClient;
  if (typeof indexedDB !== "undefined") {
    const store = new IndexedDBStore({ indexedDB, localStorage, dbName: DB_NAME });
    client = makeClient(store);
    try {
      // The store must be attached to the client before startup().
      await store.startup();
    } catch (e) {
      console.warn("IndexedDB store unavailable, falling back to memory store", e);
      client = makeClient();
    }
  } else {
    client = makeClient();
  }

  let cryptoEnabled = false;
  try {
    await client.initRustCrypto({ useIndexedDB: true, cryptoDatabasePrefix: CRYPTO_PREFIX });
    cryptoEnabled = true;
  } catch (e) {
    console.warn("End-to-end encryption unavailable", e);
  }

  await client.startClient({ lazyLoadMembers: true, initialSyncLimit: 30, pendingEventOrdering: PendingEventOrdering.Detached });
  if (import.meta.env?.DEV) (window as unknown as { abeaClient?: MatrixClient }).abeaClient = client;
  return { client, cryptoEnabled };
}

export async function destroyClient(client: MatrixClient, { logout }: { logout: boolean }): Promise<void> {
  if (logout) {
    try {
      await client.logout(true);
    } catch (e) {
      console.warn("Logout request failed", e);
    }
  }
  client.stopClient();
  clearSecretKeyCache();
  try {
    await client.clearStores({ cryptoDatabasePrefix: CRYPTO_PREFIX });
  } catch (e) {
    console.warn("Failed to clear stores", e);
  }
}

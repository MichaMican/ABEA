import { useCallback, useEffect, useState } from "react";
import { ClientEvent, type MatrixClient, MatrixError, type UIAuthCallback } from "matrix-js-sdk";
import {
  CryptoEvent,
  decodeRecoveryKey,
  type CryptoCallbacks,
  type GeneratedSecretStorageKey,
  type UserVerificationStatus,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import type { SecretStorageKeyDescription } from "matrix-js-sdk/lib/secret-storage.js";

/* -------------------------------------------------------------------------------------------------
 * Interactive prompts
 *
 * The crypto stack occasionally needs input from the user (their recovery key to unlock secret
 * storage, or their password to authorise uploading cross-signing keys / deleting devices).
 * The UI registers handlers here (see SecurityProvider); the Matrix layer calls them on demand.
 * -----------------------------------------------------------------------------------------------*/

export interface SecurityPrompts {
  /** Ask the user for their recovery key. Must resolve to the decoded key, or null if cancelled. */
  recoveryKey: (check: (key: Uint8Array) => Promise<boolean>) => Promise<Uint8Array | null>;
  /** Ask the user for their account password. Resolves to null if cancelled. */
  password: (reason: string) => Promise<string | null>;
}

let prompts: SecurityPrompts | null = null;
export function registerSecurityPrompts(p: SecurityPrompts | null): void {
  prompts = p;
}

/** Secret-storage keys unlocked during this app session (kept in memory only). */
const secretKeyCache = new Map<string, Uint8Array<ArrayBuffer>>();

export function clearSecretKeyCache(): void {
  secretKeyCache.clear();
}

export class UserCancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "UserCancelledError";
  }
}

/** Callbacks passed to `createClient`; let the Rust crypto stack access secret storage. */
export function makeCryptoCallbacks(getClient: () => MatrixClient | null): CryptoCallbacks {
  return {
    getSecretStorageKey: async ({ keys }) => {
      for (const keyId of Object.keys(keys)) {
        const cached = secretKeyCache.get(keyId);
        if (cached) return [keyId, cached];
      }
      const client = getClient();
      if (!prompts || !client) return null;
      const defaultKeyId = await client.secretStorage.getDefaultKeyId();
      const keyId = defaultKeyId && keys[defaultKeyId] ? defaultKeyId : Object.keys(keys)[0];
      if (!keyId) return null;
      const info = keys[keyId];
      const key = await prompts.recoveryKey((candidate) => client.secretStorage.checkKey(candidate as Uint8Array<ArrayBuffer>, info as never));
      if (!key) throw new UserCancelledError();
      secretKeyCache.set(keyId, key as Uint8Array<ArrayBuffer>);
      return [keyId, key as Uint8Array<ArrayBuffer>];
    },
    cacheSecretStorageKey: (keyId: string, _info: SecretStorageKeyDescription, key: Uint8Array<ArrayBuffer>) => {
      secretKeyCache.set(keyId, key);
    },
  };
}

/**
 * User-interactive auth for sensitive requests: first try without auth (Synapse allows the very
 * first cross-signing upload without it), then ask for the password if the server demands it.
 */
export function passwordAuth(client: MatrixClient, reason: string): UIAuthCallback<void> {
  return async (makeRequest) => {
    try {
      await makeRequest(null);
      return;
    } catch (e) {
      const flows = (e as MatrixError).data?.flows as { stages: string[] }[] | undefined;
      if ((e as MatrixError).httpStatus !== 401 || !flows) throw e;
      if (!flows.some((f) => f.stages.length === 1 && f.stages[0] === "m.login.password")) {
        throw new Error("Your homeserver requires a confirmation method ABEA doesn't support (e.g. single sign-on).");
      }
      const session = (e as MatrixError).data?.session as string | undefined;
      await withPassword(reason, (password) =>
        makeRequest({
          type: "m.login.password",
          identifier: { type: "m.id.user", user: client.getUserId()! },
          password,
          session,
        } as never),
      );
    }
  };
}

/**
 * Like {@link passwordAuth}, but with a password collected up front. Used when new cross-signing
 * keys are generated: they only live in memory until uploaded, and a background key query that
 * still sees the old keys would discard them while we wait for the user to type a password.
 */
function presetPasswordAuth(client: MatrixClient, password: string | null): UIAuthCallback<void> {
  return async (makeRequest) => {
    try {
      await makeRequest(null);
    } catch (e) {
      const flows = (e as MatrixError).data?.flows as { stages: string[] }[] | undefined;
      if ((e as MatrixError).httpStatus !== 401 || !flows || !password) throw e;
      try {
        await makeRequest({
          type: "m.login.password",
          identifier: { type: "m.id.user", user: client.getUserId()! },
          password,
          session: (e as MatrixError).data?.session as string | undefined,
        } as never);
      } catch (err) {
        if ((err as MatrixError).errcode === "M_FORBIDDEN") throw new Error("That password was incorrect. Please try again.");
        throw err;
      }
    }
  };
}

/** Asks for the account password if the server will need it to replace cross-signing keys. */
async function passwordForKeyReplacement(client: MatrixClient, reason: string): Promise<string | null> {
  const crypto = client.getCrypto();
  if (!crypto || !(await crypto.userHasCrossSigningKeys(client.getUserId()!, true))) return null;
  const password = await prompts?.password(reason);
  if (!password) throw new UserCancelledError();
  return password;
}

async function withPassword(reason: string, attempt: (password: string) => Promise<unknown>): Promise<void> {
  for (;;) {
    const password = await prompts?.password(reason);
    if (!password) throw new UserCancelledError();
    try {
      await attempt(password);
      return;
    } catch (e) {
      if ((e as MatrixError).httpStatus === 401 && (e as MatrixError).errcode === "M_FORBIDDEN") {
        reason = "That password was incorrect. Please try again.";
        continue;
      }
      throw e;
    }
  }
}

/* -------------------------------------------------------------------------------------------------
 * Account security state
 * -----------------------------------------------------------------------------------------------*/

export interface SecurityState {
  loading: boolean;
  /** Crypto initialised on this device. */
  available: boolean;
  /** The account has published cross-signing keys. */
  crossSigningSetUp: boolean;
  /** This device has the private cross-signing keys and they're trusted. */
  crossSigningReady: boolean;
  /** This device is signed by the account's cross-signing identity. */
  deviceVerified: boolean;
  /** A recovery key (server-side secret storage) exists for the account. */
  recoverySetUp: boolean;
  /** Secret storage holds the cross-signing + backup keys and is usable. */
  recoveryReady: boolean;
  /** Server-side key backup is active on this device. */
  backupActive: boolean;
}

const EMPTY: SecurityState = {
  loading: true,
  available: false,
  crossSigningSetUp: false,
  crossSigningReady: false,
  deviceVerified: false,
  recoverySetUp: false,
  recoveryReady: false,
  backupActive: false,
};

export async function getSecurityState(client: MatrixClient): Promise<SecurityState> {
  const crypto = client.getCrypto();
  if (!crypto) return { ...EMPTY, loading: false };
  const me = client.getUserId()!;
  const [crossSigningSetUp, crossSigningReady, device, defaultKey, recoveryReady, backupVersion] = await Promise.all([
    // Local check only: querying the server here would fire on every crypto event.
    crypto
      .getCrossSigningStatus()
      .then((s) => s.publicKeysOnDevice)
      .catch(() => false),
    crypto.isCrossSigningReady().catch(() => false),
    crypto.getDeviceVerificationStatus(me, client.getDeviceId()!).catch(() => null),
    client.secretStorage.getDefaultKeyId().catch(() => null),
    crypto.isSecretStorageReady().catch(() => false),
    crypto.getActiveSessionBackupVersion().catch(() => null),
  ]);
  return {
    loading: false,
    available: true,
    crossSigningSetUp,
    crossSigningReady,
    deviceVerified: !!device?.crossSigningVerified,
    recoverySetUp: !!defaultKey,
    recoveryReady,
    backupActive: !!backupVersion,
  };
}

const SECURITY_EVENTS = [
  CryptoEvent.KeysChanged,
  CryptoEvent.UserTrustStatusChanged,
  CryptoEvent.DevicesUpdated,
  CryptoEvent.KeyBackupStatus,
  CryptoEvent.KeyBackupDecryptionKeyCached,
] as const;

/** Emitted on the window whenever ABEA itself changed the security setup. */
export const SECURITY_CHANGED_EVENT = "abea:security-changed";
export function notifySecurityChanged(): void {
  window.dispatchEvent(new Event(SECURITY_CHANGED_EVENT));
}

export function useSecurityState(client: MatrixClient): SecurityState & { refresh: () => void } {
  const [state, setState] = useState<SecurityState>(EMPTY);
  const refresh = useCallback(() => {
    void getSecurityState(client).then(setState);
  }, [client]);
  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 150);
    };
    for (const ev of SECURITY_EVENTS) client.on(ev as never, debounced as never);
    client.on(ClientEvent.AccountData, debounced);
    window.addEventListener(SECURITY_CHANGED_EVENT, debounced);
    return () => {
      clearTimeout(timer);
      for (const ev of SECURITY_EVENTS) client.off(ev as never, debounced as never);
      client.off(ClientEvent.AccountData, debounced);
      window.removeEventListener(SECURITY_CHANGED_EVENT, debounced);
    };
  }, [client, refresh]);
  return { ...state, refresh };
}

/* -------------------------------------------------------------------------------------------------
 * Setup flows
 * -----------------------------------------------------------------------------------------------*/

/**
 * Creates cross-signing keys (if the account has none yet). Called automatically after sign-in so
 * other devices and contacts can verify this one.
 */
export async function ensureCrossSigning(client: MatrixClient): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;
  if (await crypto.userHasCrossSigningKeys(client.getUserId()!, true)) return;
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: passwordAuth(client, "Confirm your password to turn on device verification."),
  });
  notifySecurityChanged();
}

/**
 * Sets up a recovery key: stores the cross-signing keys and a fresh message-key backup in
 * server-side secret storage. Returns the recovery key the user has to write down.
 */
export async function setUpRecovery(client: MatrixClient, { reset = false } = {}): Promise<string> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available on this device.");
  let generated: GeneratedSecretStorageKey | null = null;
  const createSecretStorageKey = async () => {
    generated = await crypto.createRecoveryKeyFromPassphrase();
    return generated;
  };
  if (reset) {
    // Deletes the old backup and secret storage, then creates and uploads a new identity. The
    // password is collected first so the freshly generated keys are uploaded right away.
    const password = await passwordForKeyReplacement(client, "Enter your password to create new encryption keys.");
    await crypto.resetEncryption(presetPasswordAuth(client, password));
    // resetEncryption() already created a new backup; store its key alongside the identity.
    await crypto.bootstrapSecretStorage({ setupNewSecretStorage: true, createSecretStorageKey });
  } else {
    // Cross-signing keys must be present locally before they can be stored in secret storage.
    const status = await crypto.getCrossSigningStatus();
    if (!Object.values(status.privateKeysCachedLocally).every(Boolean)) {
      if (await crypto.userHasCrossSigningKeys(client.getUserId()!, true)) {
        throw new Error(
          "This device doesn't have your identity keys yet. Set up recovery on the device you verified this one with, or reset your keys.",
        );
      }
      await ensureCrossSigning(client);
    }
    await crypto.bootstrapSecretStorage({ setupNewSecretStorage: true, setupNewKeyBackup: true, createSecretStorageKey });
  }
  notifySecurityChanged();
  const key = (generated as GeneratedSecretStorageKey | null)?.encodedPrivateKey;
  if (!key) throw new Error("Could not create a recovery key.");
  return key;
}

/** Validates a typed recovery key against the account's secret storage. */
export async function checkRecoveryKey(client: MatrixClient, input: string): Promise<Uint8Array<ArrayBuffer> | null> {
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = decodeRecoveryKey(input.trim());
  } catch {
    return null;
  }
  const keyId = await client.secretStorage.getDefaultKeyId();
  if (!keyId) return null;
  const info = await client.secretStorage.getKey(keyId);
  if (!info) return null;
  const ok = await client.secretStorage.checkKey(key, info[1]);
  if (!ok) return null;
  secretKeyCache.set(keyId, key);
  return key;
}

/** Verifies this device with the recovery key and restores the message-key backup. */
export async function verifyWithRecoveryKey(client: MatrixClient, recoveryKey: string): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error("Encryption is not available on this device.");
  if (!(await checkRecoveryKey(client, recoveryKey))) throw new Error("That recovery key isn't correct.");
  // Without the identity in secret storage, bootstrapCrossSigning() would silently create a new one.
  if (!(await crypto.getCrossSigningStatus()).privateKeysInSecretStorage) {
    throw new Error("Your recovery storage doesn't contain your identity keys. Verify with another device or reset your keys.");
  }
  // Imports the private cross-signing keys from secret storage and signs this device.
  await crypto.bootstrapCrossSigning({});
  notifySecurityChanged();
  void restoreBackup(client, { fromSecretStorage: true });
}

/**
 * Enables key backup on this device and downloads old message keys, so history sent before this
 * device existed becomes readable.
 */
export async function restoreBackup(client: MatrixClient, { fromSecretStorage = false } = {}): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) return;
  try {
    if (fromSecretStorage) await crypto.loadSessionBackupPrivateKeyFromSecretStorage();
    const check = await crypto.checkKeyBackupAndEnable();
    if (!check?.backupInfo) return;
    if (!(await crypto.getSessionBackupPrivateKey())) return;
    await crypto.restoreKeyBackup();
    notifySecurityChanged();
  } catch (e) {
    console.warn("Key backup restore failed", e);
  }
}

/** Deletes another of the user's own devices (signs it out). */
export async function deleteDevice(client: MatrixClient, deviceId: string): Promise<void> {
  const auth = passwordAuth(client, "Confirm your password to sign out that device.");
  await auth(async (authData) => {
    await client.deleteMultipleDevices([deviceId], authData ?? undefined);
  });
}

/** Trust status of another user, kept up to date. */
export function useUserVerification(client: MatrixClient, userId: string | null | undefined): UserVerificationStatus | null {
  const [status, setStatus] = useState<UserVerificationStatus | null>(null);
  useEffect(() => {
    const crypto = client.getCrypto();
    if (!crypto || !userId) {
      setStatus(null);
      return;
    }
    let alive = true;
    const load = () => {
      crypto
        .getUserVerificationStatus(userId)
        .then((s) => alive && setStatus(s))
        .catch(() => alive && setStatus(null));
    };
    load();
    const onChange = (changed: string) => {
      if (changed === userId) load();
    };
    client.on(CryptoEvent.UserTrustStatusChanged, onChange as never);
    client.on(CryptoEvent.KeysChanged, load as never);
    window.addEventListener(SECURITY_CHANGED_EVENT, load);
    return () => {
      alive = false;
      client.off(CryptoEvent.UserTrustStatusChanged, onChange as never);
      client.off(CryptoEvent.KeysChanged, load as never);
      window.removeEventListener(SECURITY_CHANGED_EVENT, load);
    };
  }, [client, userId]);
  return status;
}

export interface DeviceSummary {
  deviceId: string;
  displayName: string;
  lastSeenTs?: number;
  lastSeenIp?: string;
  isCurrent: boolean;
  /** null: device has no encryption keys (e.g. a bot or old session). */
  verified: boolean | null;
}

/** Lists the user's own devices with their verification status. */
export function useOwnDevices(client: MatrixClient): { devices: DeviceSummary[]; loading: boolean; refresh: () => void } {
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(() => {
    const me = client.getUserId()!;
    const current = client.getDeviceId();
    const crypto = client.getCrypto();
    void (async () => {
      try {
        const { devices: list } = await client.getDevices();
        const result = await Promise.all(
          list.map(async (d): Promise<DeviceSummary> => {
            const status = crypto ? await crypto.getDeviceVerificationStatus(me, d.device_id).catch(() => null) : null;
            return {
              deviceId: d.device_id,
              displayName: d.display_name || d.device_id,
              lastSeenTs: d.last_seen_ts,
              lastSeenIp: d.last_seen_ip,
              isCurrent: d.device_id === current,
              verified: status ? status.crossSigningVerified : null,
            };
          }),
        );
        result.sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0));
        setDevices(result);
      } catch (e) {
        console.warn("Could not load devices", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [client]);
  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const debounced = () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 250);
    };
    for (const ev of SECURITY_EVENTS) client.on(ev as never, debounced as never);
    window.addEventListener(SECURITY_CHANGED_EVENT, debounced);
    return () => {
      clearTimeout(timer);
      for (const ev of SECURITY_EVENTS) client.off(ev as never, debounced as never);
      window.removeEventListener(SECURITY_CHANGED_EVENT, debounced);
    };
  }, [client, refresh]);
  return { devices, loading, refresh };
}

/** Formats a recovery key for display: groups of four characters. */
export function formatRecoveryKey(key: string): string {
  return key.replace(/\s+/g, "").replace(/(.{4})/g, "$1 ").trim();
}

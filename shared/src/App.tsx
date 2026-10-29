import { useCallback, useEffect, useRef, useState } from "react";
import { ClientEvent, HttpApiEvent, SyncState, type MatrixClient } from "matrix-js-sdk";
import { PlatformContext, defaultPlatform, type PlatformAdapter } from "./platform";
import { ThemeProvider } from "./theme/ThemeProvider";
import { ToastProvider } from "./components/Toast";
import { MatrixContext } from "./matrix/MatrixContext";
import {
  clearSession,
  createStartedClient,
  destroyClient,
  loadSession,
  loginWithLoginToken,
  saveSession,
  type StoredSession,
} from "./matrix/session";
import { LoginScreen, SSO_PENDING_KEY } from "./screens/LoginScreen";
import { AppShell } from "./screens/AppShell";
import { Splash } from "./screens/Splash";

export function App({ platform }: { platform?: PlatformAdapter }) {
  const adapter = platform ?? defaultPlatform;
  useEffect(() => {
    document.documentElement.dataset.platform = adapter.kind;
    document.documentElement.dataset.os = adapter.os;
  }, [adapter]);
  return (
    <PlatformContext.Provider value={adapter}>
      <ThemeProvider>
        <ToastProvider>
          <SessionGate />
        </ToastProvider>
      </ThemeProvider>
    </PlatformContext.Provider>
  );
}

type GateState =
  | { status: "loading"; message?: string }
  | { status: "login"; error?: string }
  | { status: "ready"; client: MatrixClient; cryptoEnabled: boolean };

function SessionGate() {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const clientRef = useRef<MatrixClient | null>(null);
  const bootedRef = useRef(false);

  const start = useCallback(async (session: StoredSession) => {
    setState({ status: "loading", message: "Connecting to your homeserver…" });
    try {
      const { client, cryptoEnabled } = await createStartedClient(session);
      clientRef.current = client;
      await waitForFirstSync(client);
      setState({ status: "ready", client, cryptoEnabled });
    } catch (e) {
      console.error(e);
      const errcode = (e as { errcode?: string; data?: { errcode?: string } }).errcode ?? (e as { data?: { errcode?: string } }).data?.errcode;
      if (errcode === "M_UNKNOWN_TOKEN") {
        clearSession();
        setState({ status: "login", error: "Your session has expired. Please sign in again." });
      } else {
        setState({ status: "login", error: (e as Error).message || "Could not connect." });
      }
    }
  }, []);

  useEffect(() => {
    // Guard against double invocation (React StrictMode) which would start two sync loops.
    if (bootedRef.current) return;
    bootedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const loginToken = params.get("loginToken");
    const pendingHs = sessionStorage.getItem(SSO_PENDING_KEY);
    if (loginToken && pendingHs) {
      sessionStorage.removeItem(SSO_PENDING_KEY);
      params.delete("loginToken");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
      setState({ status: "loading", message: "Completing sign in…" });
      loginWithLoginToken(pendingHs, loginToken)
        .then((session) => {
          saveSession(session);
          return start(session);
        })
        .catch((e) => setState({ status: "login", error: (e as Error).message }));
      return;
    }
    const session = loadSession();
    if (session) void start(session);
    else setState({ status: "login" });
  }, [start]);

  const logout = useCallback(async () => {
    const client = clientRef.current;
    clientRef.current = null;
    clearSession();
    setState({ status: "loading", message: "Signing out…" });
    if (client) await destroyClient(client, { logout: true });
    window.location.hash = "";
    setState({ status: "login" });
  }, []);

  useEffect(() => {
    if (state.status !== "ready") return;
    const client = state.client;
    const onLoggedOut = async () => {
      clientRef.current = null;
      clearSession();
      await destroyClient(client, { logout: false });
      setState({ status: "login", error: "You were signed out by the server." });
    };
    client.on(HttpApiEvent.SessionLoggedOut, onLoggedOut);
    return () => {
      client.off(HttpApiEvent.SessionLoggedOut, onLoggedOut);
    };
  }, [state]);

  if (state.status === "loading") return <Splash message={state.message} />;
  if (state.status === "login") {
    return (
      <LoginScreen
        initialError={state.error}
        onSession={(session) => {
          saveSession(session);
          void start(session);
        }}
      />
    );
  }
  return (
    <MatrixContext.Provider value={{ client: state.client, cryptoEnabled: state.cryptoEnabled, logout }}>
      <AppShell />
    </MatrixContext.Provider>
  );
}

function waitForFirstSync(client: MatrixClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const current = client.getSyncState();
    if (current === SyncState.Prepared || current === SyncState.Syncing) return resolve();
    const onSync = (s: SyncState, _prev: SyncState | null, data?: { error?: Error }) => {
      if (s === SyncState.Prepared || s === SyncState.Syncing) {
        client.off(ClientEvent.Sync, onSync);
        resolve();
      } else if (s === SyncState.Error) {
        const err = data?.error as (Error & { errcode?: string }) | undefined;
        if (err?.errcode === "M_UNKNOWN_TOKEN") {
          client.off(ClientEvent.Sync, onSync);
          client.stopClient();
          reject(err);
        }
      }
    };
    client.on(ClientEvent.Sync, onSync);
  });
}

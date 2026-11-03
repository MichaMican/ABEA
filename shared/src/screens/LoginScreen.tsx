import { useEffect, useState, type FormEvent } from "react";
import { AtSign, Eye, EyeOff, KeyRound, Lock, Server, ShieldCheck, Sparkles, Users } from "lucide-react";
import { Logo } from "../components/Logo";
import { Button, TextField } from "../components/ui";
import { usePlatform } from "../platform";
import {
  fetchLoginFlows,
  getSsoRedirectUrl,
  loginWithPassword,
  register,
  resolveHomeserver,
  type LoginFlows,
  type StoredSession,
} from "../matrix/session";
import { errorMessage } from "../components/Toast";

export const SSO_PENDING_KEY = "abea.sso.homeserver";
const LAST_SERVER_KEY = "abea.lastServer";

type Mode = "signin" | "register";

export function LoginScreen({
  onSession,
  initialError,
}: {
  onSession: (s: StoredSession) => void;
  initialError?: string;
}) {
  const platform = usePlatform();
  const [mode, setMode] = useState<Mode>("signin");
  const [server, setServer] = useState(() => localStorage.getItem(LAST_SERVER_KEY) ?? "matrix.org");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [flows, setFlows] = useState<{ server: string; baseUrl: string; flows: LoginFlows } | null>(null);
  const [checking, setChecking] = useState(false);

  // If the user types a full MXID, use its server part automatically.
  useEffect(() => {
    const m = username.trim().match(/^@[^:]+:(.+)$/);
    if (m) setServer(m[1]);
  }, [username]);

  useEffect(() => {
    const value = server.trim();
    if (!value) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const baseUrl = await resolveHomeserver(value);
        const f = await fetchLoginFlows(baseUrl);
        if (!cancelled) setFlows({ server: value, baseUrl, flows: f });
      } catch {
        if (!cancelled) setFlows(null);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [server]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const baseUrl = flows?.server === server.trim() ? flows.baseUrl : await resolveHomeserver(server);
      localStorage.setItem(LAST_SERVER_KEY, server.trim());
      const session =
        mode === "signin" ? await loginWithPassword(baseUrl, username, password) : await register(baseUrl, username, password);
      onSession(session);
    } catch (err) {
      const code = (err as { errcode?: string }).errcode;
      if (code === "M_FORBIDDEN") setError("Incorrect username or password.");
      else if (code === "M_USER_IN_USE") setError("That username is already taken.");
      else setError(errorMessage(err, "Sign in failed."));
      setBusy(false);
    }
  };

  const startSso = (idpId?: string) => {
    if (!flows) return;
    sessionStorage.setItem(SSO_PENDING_KEY, flows.baseUrl);
    localStorage.setItem(LAST_SERVER_KEY, server.trim());
    const redirect = `${window.location.origin}${window.location.pathname}`;
    window.location.href = getSsoRedirectUrl(flows.baseUrl, redirect, idpId);
  };

  const ssoAvailable = !!flows?.flows.sso && !!platform.supportsSsoRedirect && mode === "signin";
  const passwordAvailable = !flows || flows.flows.password;

  return (
    <div className="login">
      <aside className="login__hero">
        <div className="login__hero-inner">
          <div className="login__brand">
            <Logo size={52} />
            <span>ABEA</span>
          </div>
          <h1>
            Conversations that
            <br />
            belong to <em>you</em>.
          </h1>
          <p>A beautiful, open messenger built on Matrix — the decentralised standard for secure, interoperable chat.</p>
          <ul className="login__features">
            <li>
              <ShieldCheck size={20} /> End-to-end encryption
            </li>
            <li>
              <Users size={20} /> Group chats & contacts
            </li>
            <li>
              <Sparkles size={20} /> Works with any Matrix server
            </li>
          </ul>
          <div className="login__bubbles" aria-hidden="true">
            <div className="hero-bubble hero-bubble--in">Hey! Are you on Matrix yet? 👋</div>
            <div className="hero-bubble hero-bubble--out">Just joined with ABEA ✨</div>
            <div className="hero-bubble hero-bubble--in">Welcome! 🎉</div>
          </div>
        </div>
      </aside>

      <main className="login__panel">
        <form className="login__card" onSubmit={submit}>
          <div className="login__mobile-brand">
            <Logo size={64} />
          </div>
          <h2>{mode === "signin" ? "Welcome back" : "Create your account"}</h2>
          <p className="login__subtitle">
            {mode === "signin" ? "Sign in to your Matrix account" : "Join the open Matrix network"}
          </p>

          <div className="segmented" role="tablist">
            <button type="button" className={mode === "signin" ? "is-active" : ""} onClick={() => setMode("signin")}>
              Sign in
            </button>
            <button type="button" className={mode === "register" ? "is-active" : ""} onClick={() => setMode("register")}>
              Create account
            </button>
          </div>

          <TextField
            label="Homeserver"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            leading={<Server size={18} />}
            trailing={
              checking ? (
                <span className="server-dot is-checking" />
              ) : flows?.server === server.trim() ? (
                <span className="server-dot is-ok" title="Server found" />
              ) : server.trim() ? (
                <span className="server-dot is-bad" title="Server not found" />
              ) : null
            }
            placeholder="matrix.org"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            hint={flows?.server === server.trim() ? flows.baseUrl.replace(/^https?:\/\//, "") : "Your Matrix provider, e.g. matrix.org"}
          />

          {passwordAvailable && (
            <>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                leading={<AtSign size={18} />}
                placeholder={mode === "signin" ? "username or @user:server" : "choose a username"}
                autoComplete="username"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
              />
              <TextField
                label="Password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                leading={<Lock size={18} />}
                trailing={
                  <button
                    type="button"
                    className="field__icon-btn"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                }
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
              {mode === "register" && (
                <TextField
                  label="Confirm password"
                  type={showPassword ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  leading={<KeyRound size={18} />}
                  autoComplete="new-password"
                />
              )}
            </>
          )}

          {error && <div className="form-error">{error}</div>}

          {passwordAvailable && (
            <Button type="submit" size="lg" block loading={busy}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          )}

          {ssoAvailable && (
            <>
              {passwordAvailable && <div className="divider-text">or</div>}
              {flows!.flows.identityProviders.length > 0 ? (
                flows!.flows.identityProviders.map((idp) => (
                  <Button key={idp.id} type="button" variant="secondary" block onClick={() => startSso(idp.id)}>
                    Continue with {idp.name}
                  </Button>
                ))
              ) : (
                <Button type="button" variant="secondary" block onClick={() => startSso()}>
                  Continue with single sign-on
                </Button>
              )}
            </>
          )}

          {!passwordAvailable && !ssoAvailable && (
            <div className="form-error">This homeserver does not support password sign in on this device.</div>
          )}

          <p className="login__footnote">
            New to Matrix?{" "}
            <a
              href="https://matrix.org/docs/chat_basics/matrix-for-im/"
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (platform.openExternal) {
                  e.preventDefault();
                  platform.openExternal("https://matrix.org/docs/chat_basics/matrix-for-im/");
                }
              }}
            >
              Learn how it works
            </a>
          </p>
        </form>
      </main>
    </div>
  );
}

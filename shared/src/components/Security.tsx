import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CryptoEvent,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type ShowSasCallbacks,
  type VerificationRequest,
  type Verifier,
} from "matrix-js-sdk/lib/crypto-api/index.js";
import {
  Check,
  CircleCheck,
  Copy,
  Download,
  KeyRound,
  Laptop,
  LogOut,
  MonitorSmartphone,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";
import { useMatrix } from "../matrix/MatrixContext";
import { useProfile } from "../matrix/hooks";
import {
  UserCancelledError,
  checkRecoveryKey,
  deleteDevice,
  ensureCrossSigning,
  formatRecoveryKey,
  registerSecurityPrompts,
  restoreBackup,
  setUpRecovery,
  useOwnDevices,
  useSecurityState,
  verifyWithRecoveryKey,
  type DeviceSummary,
  type SecurityState,
} from "../matrix/security";
import { Avatar } from "./Avatar";
import { Button, Modal, Spinner, TextField } from "./ui";
import { useToast } from "./Toast";
import { ConfirmDialog } from "./ConfirmDialog";

/* =================================================================================================
 * Context
 * ===============================================================================================*/

interface SecurityUi {
  state: SecurityState;
  /** Shows the interactive verification dialog for a request (outgoing or incoming). */
  showVerification: (request: Promise<VerificationRequest> | VerificationRequest) => void;
  openRecoverySetup: (opts?: { reset?: boolean }) => void;
  openVerifyDevice: () => void;
}

const SecurityContext = createContext<SecurityUi | null>(null);

export function useSecurity(): SecurityUi {
  const ctx = useContext(SecurityContext);
  if (!ctx) throw new Error("useSecurity must be used inside SecurityProvider");
  return ctx;
}

type Dialog =
  | { kind: "none" }
  | { kind: "verification"; request: VerificationRequest | null; error?: string }
  | { kind: "recovery-setup"; reset: boolean }
  | { kind: "verify-device" };

const PROMPTED_KEY = "abea.verifyPrompted";

export function SecurityProvider({ children }: { children: ReactNode }) {
  const { client, cryptoEnabled } = useMatrix();
  const toast = useToast();
  const state = useSecurityState(client);
  const [dialog, setDialog] = useState<Dialog>({ kind: "none" });
  const dialogRef = useRef(dialog);
  dialogRef.current = dialog;

  // ---- prompts requested by the crypto layer -------------------------------------------------
  const [passwordPrompt, setPasswordPrompt] = useState<{ reason: string; resolve: (v: string | null) => void } | null>(null);
  const [keyPrompt, setKeyPrompt] = useState<{
    check: (key: Uint8Array) => Promise<boolean>;
    resolve: (v: Uint8Array | null) => void;
  } | null>(null);

  useEffect(() => {
    registerSecurityPrompts({
      password: (reason) => new Promise((resolve) => setPasswordPrompt({ reason, resolve })),
      recoveryKey: (check) => new Promise((resolve) => setKeyPrompt({ check, resolve })),
    });
    return () => registerSecurityPrompts(null);
  }, []);

  // ---- automatic setup after sign-in ---------------------------------------------------------
  useEffect(() => {
    if (!cryptoEnabled) return;
    ensureCrossSigning(client).catch((e) => {
      if (!(e instanceof UserCancelledError)) console.warn("Cross-signing setup failed", e);
    });
    // Old message keys arrive from another device after verification: load them from backup.
    const onBackupKey = () => void restoreBackup(client);
    client.on(CryptoEvent.KeyBackupDecryptionKeyCached, onBackupKey);
    return () => {
      client.off(CryptoEvent.KeyBackupDecryptionKeyCached, onBackupKey);
    };
  }, [client, cryptoEnabled]);

  // Ask once per device to verify it when the account already has other verified devices.
  useEffect(() => {
    if (state.loading || !state.available) return;
    if (!state.crossSigningSetUp || state.deviceVerified) return;
    const key = `${PROMPTED_KEY}.${client.getDeviceId()}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    if (dialogRef.current.kind === "none") setDialog({ kind: "verify-device" });
  }, [state.loading, state.available, state.crossSigningSetUp, state.deviceVerified, client]);

  // ---- incoming verification requests ---------------------------------------------------------
  useEffect(() => {
    const onRequest = (request: VerificationRequest) => {
      if (request.initiatedByMe || request.phase !== VerificationPhase.Requested) return;
      const current = dialogRef.current;
      if (current.kind === "verification" && current.request && !isFinished(current.request)) {
        void request.cancel({ reason: "Busy with another verification", code: "m.user" }).catch(() => undefined);
        return;
      }
      setDialog({ kind: "verification", request });
    };
    client.on(CryptoEvent.VerificationRequestReceived, onRequest);
    return () => {
      client.off(CryptoEvent.VerificationRequestReceived, onRequest);
    };
  }, [client]);

  const showVerification = useCallback(
    (request: Promise<VerificationRequest> | VerificationRequest) => {
      if (!("then" in request)) {
        setDialog({ kind: "verification", request });
        return;
      }
      setDialog({ kind: "verification", request: null });
      request
        .then((r) => setDialog((d) => (d.kind === "verification" ? { kind: "verification", request: r } : d)))
        .catch((e) => {
          console.warn(e);
          setDialog((d) => (d.kind === "verification" ? { kind: "verification", request: null, error: (e as Error).message } : d));
        });
    },
    [],
  );

  const ui = useMemo<SecurityUi>(
    () => ({
      state,
      showVerification,
      openRecoverySetup: (opts) => setDialog({ kind: "recovery-setup", reset: !!opts?.reset }),
      openVerifyDevice: () => setDialog({ kind: "verify-device" }),
    }),
    [state, showVerification],
  );

  const close = useCallback(() => {
    const current = dialogRef.current;
    if (current.kind === "verification" && current.request && !isFinished(current.request)) {
      void current.request.cancel().catch(() => undefined);
    }
    setDialog({ kind: "none" });
  }, []);

  return (
    <SecurityContext.Provider value={ui}>
      {children}
      {dialog.kind === "verification" && (
        <VerificationDialog request={dialog.request} error={dialog.error} onClose={close} />
      )}
      {dialog.kind === "recovery-setup" && <RecoverySetupDialog reset={dialog.reset} onClose={close} />}
      {dialog.kind === "verify-device" && (
        <VerifyDeviceDialog
          state={state}
          onClose={close}
          onUseOtherDevice={() => {
            const crypto = client.getCrypto();
            if (!crypto) return;
            showVerification(crypto.requestOwnUserVerification());
          }}
          onReset={() => setDialog({ kind: "recovery-setup", reset: true })}
          onVerified={() => toast.show("This device is now verified", "success")}
        />
      )}
      <PasswordPrompt
        prompt={passwordPrompt}
        onDone={(value) => {
          passwordPrompt?.resolve(value);
          setPasswordPrompt(null);
        }}
      />
      <RecoveryKeyPrompt
        prompt={keyPrompt}
        onDone={(value) => {
          keyPrompt?.resolve(value);
          setKeyPrompt(null);
        }}
      />
    </SecurityContext.Provider>
  );
}

function isFinished(request: VerificationRequest): boolean {
  return request.phase === VerificationPhase.Done || request.phase === VerificationPhase.Cancelled;
}

/* =================================================================================================
 * Interactive verification (emoji comparison)
 * ===============================================================================================*/

const CANCEL_REASONS: Record<string, string> = {
  "m.user": "Verification was cancelled.",
  "m.timeout": "The verification request timed out.",
  "m.mismatched_sas": "The emoji didn't match, so the verification was stopped. Your conversation may not be secure.",
  "m.key_mismatch": "The keys didn't match. Your conversation may not be secure.",
  "m.accepted": "The request was accepted on another device.",
  "m.unknown_method": "The other device doesn't support emoji verification.",
  "m.unexpected_message": "The other device sent an unexpected message.",
};

function useRequestPhase(request: VerificationRequest | null): number {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!request) return;
    request.on(VerificationRequestEvent.Change, force);
    return () => {
      request.off(VerificationRequestEvent.Change, force);
    };
  }, [request]);
  return request?.phase ?? VerificationPhase.Unsent;
}

function VerificationDialog({
  request,
  error,
  onClose,
}: {
  request: VerificationRequest | null;
  error?: string;
  onClose: () => void;
}) {
  const { client } = useMatrix();
  const phase = useRequestPhase(request);
  const [sas, setSas] = useState<ShowSasCallbacks | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [canStart, setCanStart] = useState(false);
  const verifierRef = useRef<Verifier | null>(null);
  const startedRef = useRef(false);

  const otherUserId = request?.otherUserId ?? client.getUserId()!;
  const profile = useProfile(otherUserId);
  const self = request ? request.isSelfVerification : true;
  const name = self ? "your other device" : (profile?.displayName ?? otherUserId);

  const attach = useCallback((verifier: Verifier) => {
    if (verifierRef.current === verifier) return;
    verifierRef.current = verifier;
    verifier.on(VerifierEvent.ShowSas, setSas);
    const existing = verifier.getShowSasCallbacks();
    if (existing) setSas(existing);
    verifier.verify().catch((e) => console.info("Verification ended", e));
  }, []);

  const start = useCallback(async () => {
    if (!request || startedRef.current) return;
    startedRef.current = true;
    try {
      attach(await request.startVerification("m.sas.v1"));
    } catch (e) {
      startedRef.current = false;
      setStartError((e as Error).message);
    }
  }, [request, attach]);

  useEffect(() => {
    if (!request) return;
    if (request.verifier) attach(request.verifier);
    if (phase === VerificationPhase.Ready && request.initiatedByMe) void start();
    if (phase === VerificationPhase.Ready && !request.initiatedByMe) {
      // The requester normally starts; offer a manual start in case it doesn't (e.g. other clients).
      const t = setTimeout(() => setCanStart(true), 2500);
      return () => clearTimeout(t);
    }
  }, [request, phase, attach, start]);

  useEffect(() => {
    if (phase === VerificationPhase.Done && self) void restoreBackup(client);
  }, [phase, self, client]);

  let body: ReactNode;
  let footer: ReactNode = null;
  const title = self ? "Verify device" : `Verify ${profile?.displayName ?? otherUserId}`;

  if (error) {
    body = <VerifyStatus tone="danger" icon={<X size={30} />} title="Couldn't start verification" text={error} />;
    footer = <Button onClick={onClose}>Close</Button>;
  } else if (!request || phase === VerificationPhase.Unsent) {
    body = <VerifyStatus icon={<Spinner size={30} />} title="Sending request…" />;
  } else if (phase === VerificationPhase.Cancelled) {
    const code = request.cancellationCode ?? "m.user";
    body = (
      <VerifyStatus
        tone={code === "m.mismatched_sas" || code === "m.key_mismatch" ? "danger" : "muted"}
        icon={<ShieldAlert size={30} />}
        title="Verification cancelled"
        text={CANCEL_REASONS[code] ?? `Verification was cancelled (${code}).`}
      />
    );
    footer = <Button onClick={onClose}>Close</Button>;
  } else if (phase === VerificationPhase.Done) {
    body = (
      <VerifyStatus
        tone="success"
        icon={<ShieldCheck size={34} />}
        title="Verified!"
        text={
          self
            ? "Your devices now trust each other. Encrypted messages are shared securely between them."
            : `You've verified ${name}. Messages between you are now marked as trusted.`
        }
      />
    );
    footer = <Button onClick={onClose}>Done</Button>;
  } else if (phase === VerificationPhase.Requested && !request.initiatedByMe) {
    body = (
      <div className="verify-incoming">
        {self ? (
          <div className="verify-hero">
            <MonitorSmartphone size={34} />
          </div>
        ) : (
          <Avatar mxc={profile?.avatarMxc} name={name} id={otherUserId} size={84} />
        )}
        <h3>{self ? "Another device wants to verify" : `${name} wants to verify you`}</h3>
        <p className="muted">
          {self
            ? `A sign-in on device ${request.otherDeviceId ?? ""} is asking to be trusted. Only accept if this was you.`
            : "Verifying makes sure you're talking to the right person and that nobody is listening in."}
        </p>
      </div>
    );
    footer = (
      <>
        <Button variant="secondary" onClick={() => void request.cancel().then(onClose, onClose)}>
          Decline
        </Button>
        <Button loading={request.accepting} onClick={() => void request.accept()}>
          Accept
        </Button>
      </>
    );
  } else if (phase === VerificationPhase.Requested) {
    body = (
      <VerifyStatus
        icon={<Spinner size={30} />}
        title={self ? "Check your other device" : `Waiting for ${name}…`}
        text={
          self
            ? "Open ABEA (or another Matrix app) on a device where you're already signed in and accept the verification request."
            : `${name} needs to accept the request in their app.`
        }
      />
    );
    footer = (
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
    );
  } else if (sas?.sas.emoji) {
    body = (
      <div className="verify-sas">
        <p className="muted">
          Compare these emoji with the ones shown on {self ? "your other device" : `${name}'s screen`}. They must appear in the same
          order.
        </p>
        <div className="sas-grid">
          {sas.sas.emoji.map(([emoji, label], i) => (
            <div className="sas-tile" key={i} style={{ animationDelay: `${i * 45}ms` }}>
              <span className="sas-tile__emoji">{emoji}</span>
              <span className="sas-tile__label">{label}</span>
            </div>
          ))}
        </div>
        {confirming && (
          <p className="verify-sas__waiting">
            <Spinner size={16} /> Waiting for {self ? "your other device" : name} to confirm…
          </p>
        )}
      </div>
    );
    footer = confirming ? null : (
      <>
        <Button variant="secondary" onClick={() => sas.mismatch()}>
          They don't match
        </Button>
        <Button
          icon={<Check size={18} />}
          onClick={() => {
            setConfirming(true);
            void sas.confirm().catch(() => setConfirming(false));
          }}
        >
          They match
        </Button>
      </>
    );
  } else {
    body = (
      <VerifyStatus
        icon={<Spinner size={30} />}
        title="Securely connecting…"
        text={startError ?? `Exchanging keys with ${name}.`}
      />
    );
    footer =
      canStart && !request.verifier ? (
        <Button onClick={() => void start()}>Compare emoji</Button>
      ) : (
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      );
  }

  return (
    <Modal open onClose={onClose} title={title} size="sm" className="verify-modal" footer={footer}>
      {body}
    </Modal>
  );
}

function VerifyStatus({
  icon,
  title,
  text,
  tone = "accent",
}: {
  icon: ReactNode;
  title: string;
  text?: ReactNode;
  tone?: "accent" | "success" | "danger" | "muted";
}) {
  return (
    <div className={`verify-status verify-status--${tone}`}>
      <div className="verify-status__icon">{icon}</div>
      <h3>{title}</h3>
      {text && <p>{text}</p>}
    </div>
  );
}

/* =================================================================================================
 * Recovery key
 * ===============================================================================================*/

function RecoverySetupDialog({ reset, onClose }: { reset: boolean; onClose: () => void }) {
  const { client } = useMatrix();
  const toast = useToast();
  const [step, setStep] = useState<"intro" | "working" | "key">("intro");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setStep("working");
    setError(null);
    try {
      setKey(await setUpRecovery(client, { reset }));
      setStep("key");
    } catch (e) {
      setStep("intro");
      if (!(e instanceof UserCancelledError)) setError((e as Error).message || "Something went wrong.");
    }
  };

  const formatted = formatRecoveryKey(key);
  const copy = async () => {
    await navigator.clipboard?.writeText(formatted);
    setSaved(true);
    toast.show("Recovery key copied", "success");
  };
  const download = () => {
    const blob = new Blob(
      [`ABEA recovery key for ${client.getUserId()}\n\n${formatted}\n\nKeep this somewhere safe. Anyone with this key can read your encrypted messages.\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "abea-recovery-key.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };

  return (
    <Modal
      open
      onClose={step === "working" ? () => undefined : onClose}
      title={reset ? "Reset encryption" : "Set up recovery"}
      size="sm"
      className="verify-modal"
      footer={
        step === "intro" ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Not now
            </Button>
            <Button variant={reset ? "danger" : "primary"} onClick={() => void run()}>
              {reset ? "Reset" : "Continue"}
            </Button>
          </>
        ) : step === "key" ? (
          <Button disabled={!saved} onClick={onClose}>
            I've saved my key
          </Button>
        ) : null
      }
    >
      {step === "intro" && (
        <div className="verify-status verify-status--accent">
          <div className="verify-status__icon">{reset ? <ShieldAlert size={30} /> : <KeyRound size={30} />}</div>
          <h3>{reset ? "Start over with new keys?" : "Never lose your messages"}</h3>
          <p>
            {reset
              ? "Your verified devices and contacts will need to verify you again, and you may lose access to old encrypted messages unless you have them on another device."
              : "A recovery key lets you verify new devices and read your encrypted message history, even if you lose all your devices."}
          </p>
          {error && <div className="form-error">{error}</div>}
        </div>
      )}
      {step === "working" && <VerifyStatus icon={<Spinner size={30} />} title="Creating your keys…" />}
      {step === "key" && (
        <div className="recovery-key">
          <p className="muted">Store this key in a password manager or write it down. You'll need it to verify new devices.</p>
          <code className="recovery-key__value">{formatted}</code>
          <div className="recovery-key__actions">
            <Button variant="secondary" icon={<Copy size={16} />} onClick={() => void copy()}>
              Copy
            </Button>
            <Button variant="secondary" icon={<Download size={16} />} onClick={download}>
              Download
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function VerifyDeviceDialog({
  state,
  onClose,
  onUseOtherDevice,
  onReset,
  onVerified,
}: {
  state: SecurityState;
  onClose: () => void;
  onUseOtherDevice: () => void;
  onReset: () => void;
  onVerified: () => void;
}) {
  const { client } = useMatrix();
  const [mode, setMode] = useState<"choose" | "key">("choose");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyWithRecoveryKey(client, value);
      onVerified();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Verify this device" size="sm" className="verify-modal">
      {mode === "choose" ? (
        <div className="verify-choose">
          <div className="verify-status verify-status--accent">
            <div className="verify-status__icon">
              <ShieldCheck size={30} />
            </div>
            <h3>Confirm it's you</h3>
            <p>Verify this device to read your encrypted message history and to show your contacts that it's really you.</p>
          </div>
          <button className="verify-option" onClick={onUseOtherDevice}>
            <MonitorSmartphone size={22} />
            <span>
              <strong>Use another device</strong>
              <small>Compare emoji with a device where you're already signed in</small>
            </span>
          </button>
          {state.recoverySetUp && (
            <button className="verify-option" onClick={() => setMode("key")}>
              <KeyRound size={22} />
              <span>
                <strong>Use recovery key</strong>
                <small>Enter the key you saved when setting up recovery</small>
              </span>
            </button>
          )}
          <button className="verify-reset" onClick={onReset}>
            Can't verify? Reset your encryption keys
          </button>
        </div>
      ) : (
        <form
          className="verify-key-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <TextField
            label="Recovery key"
            placeholder="EsT1 abcd …"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            error={error}
            leading={<KeyRound size={18} />}
          />
          <div className="modal__inline-footer">
            <Button type="button" variant="secondary" onClick={() => setMode("choose")}>
              Back
            </Button>
            <Button type="submit" loading={busy} disabled={!value.trim()}>
              Verify
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function RecoveryKeyPrompt({
  prompt,
  onDone,
}: {
  prompt: { check: (key: Uint8Array) => Promise<boolean> } | null;
  onDone: (value: Uint8Array | null) => void;
}) {
  const { client } = useMatrix();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setValue("");
    setError(null);
  }, [prompt]);
  if (!prompt) return null;
  const submit = async () => {
    setBusy(true);
    setError(null);
    const key = await checkRecoveryKey(client, value).catch(() => null);
    setBusy(false);
    if (!key || !(await prompt.check(key))) {
      setError("That recovery key isn't correct.");
      return;
    }
    onDone(key);
  };
  return (
    <Modal open onClose={() => onDone(null)} title="Enter recovery key" size="sm" className="verify-modal">
      <form
        className="verify-key-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="muted">ABEA needs your recovery key to access your encrypted backup.</p>
        <TextField
          label="Recovery key"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          error={error}
          leading={<KeyRound size={18} />}
        />
        <div className="modal__inline-footer">
          <Button type="button" variant="secondary" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={!value.trim()}>
            Continue
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PasswordPrompt({
  prompt,
  onDone,
}: {
  prompt: { reason: string } | null;
  onDone: (value: string | null) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(""), [prompt]);
  if (!prompt) return null;
  return (
    <Modal open onClose={() => onDone(null)} title="Confirm your identity" size="sm">
      <form
        className="verify-key-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onDone(value);
        }}
      >
        <p className="muted">{prompt.reason}</p>
        <TextField label="Password" type="password" value={value} onChange={(e) => setValue(e.target.value)} autoFocus autoComplete="current-password" />
        <div className="modal__inline-footer">
          <Button type="button" variant="secondary" onClick={() => onDone(null)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!value}>
            Confirm
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* =================================================================================================
 * Building blocks used across screens
 * ===============================================================================================*/

/** Call-to-action shown above the chat list until this device is verified / recovery is set up. */
export function SecurityBanner() {
  const { cryptoEnabled } = useMatrix();
  const { state, openVerifyDevice, openRecoverySetup } = useSecurity();
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem("abea.securityBanner") === "0");
  if (!cryptoEnabled || state.loading || !state.available || dismissed) return null;
  const dismiss = () => {
    sessionStorage.setItem("abea.securityBanner", "0");
    setDismissed(true);
  };

  if (state.crossSigningSetUp && !state.deviceVerified) {
    return (
      <div className="security-banner security-banner--warning" role="status">
        <ShieldAlert size={20} />
        <div className="security-banner__text">
          <strong>Verify this device</strong>
          <span>Confirm it's you to read encrypted history.</span>
        </div>
        <Button size="sm" onClick={openVerifyDevice}>
          Verify
        </Button>
        <button className="security-banner__close" aria-label="Dismiss" onClick={dismiss}>
          <X size={16} />
        </button>
      </div>
    );
  }
  if (state.deviceVerified && !state.recoverySetUp) {
    return (
      <div className="security-banner" role="status">
        <KeyRound size={20} />
        <div className="security-banner__text">
          <strong>Set up recovery</strong>
          <span>Keep access to encrypted chats if you lose your devices.</span>
        </div>
        <Button size="sm" onClick={() => openRecoverySetup()}>
          Set up
        </Button>
        <button className="security-banner__close" aria-label="Dismiss" onClick={dismiss}>
          <X size={16} />
        </button>
      </div>
    );
  }
  return null;
}

/** Shield shown next to a user's name: green when verified, warning when their identity changed. */
export function TrustBadge({
  verified,
  changed,
  size = 14,
  label = false,
}: {
  verified: boolean;
  changed?: boolean;
  size?: number;
  label?: boolean;
}) {
  if (changed) {
    return (
      <span className="trust trust--warning" title="Identity changed – verify again">
        <ShieldAlert size={size} />
        {label && "Identity changed"}
      </span>
    );
  }
  if (!verified) return null;
  return (
    <span className="trust trust--verified" title="Verified">
      <ShieldCheck size={size} />
      {label && "Verified"}
    </span>
  );
}

/** "Security" settings: device status, recovery and the list of signed-in devices. */
export function SecuritySettings() {
  const { client, cryptoEnabled } = useMatrix();
  const toast = useToast();
  const { state, openVerifyDevice, openRecoverySetup, showVerification } = useSecurity();
  const { devices, loading, refresh } = useOwnDevices(client);
  const [signOut, setSignOut] = useState<DeviceSummary | null>(null);

  if (!cryptoEnabled) {
    return (
      <section className="settings-card settings-list">
        <div className="settings-row">
          <ShieldAlert size={20} className="muted" />
          <div className="settings-row__text">
            <span>End-to-end encryption</span>
            <small>Not available on this device.</small>
          </div>
        </div>
      </section>
    );
  }

  const verified = state.deviceVerified;
  return (
    <>
      <section className={`settings-card security-hero ${verified ? "is-verified" : "is-unverified"}`}>
        <div className="security-hero__icon">{verified ? <ShieldCheck size={28} /> : <ShieldAlert size={28} />}</div>
        <div className="security-hero__text">
          <strong>{state.loading ? "Checking…" : verified ? "This device is verified" : "This device isn't verified"}</strong>
          <span>
            {verified
              ? "Messages are end-to-end encrypted and your other devices and contacts can trust this one."
              : "Verify it with another device or your recovery key to access encrypted history."}
          </span>
        </div>
        {!state.loading && !verified && (
          <Button size="sm" onClick={openVerifyDevice}>
            Verify
          </Button>
        )}
      </section>

      <section className="settings-card settings-list">
        <div className="settings-row">
          <KeyRound size={20} className={state.recoverySetUp ? "text-success" : "muted"} />
          <div className="settings-row__text">
            <span>Recovery key</span>
            <small>
              {state.recoverySetUp
                ? state.backupActive
                  ? "Set up · Your message keys are backed up"
                  : "Set up"
                : "Not set up · You could lose access to encrypted chats"}
            </small>
          </div>
          {verified && (
            <Button size="sm" variant="secondary" onClick={() => openRecoverySetup()}>
              {state.recoverySetUp ? "Change" : "Set up"}
            </Button>
          )}
        </div>
      </section>

      <h2 className="settings__section">Your devices</h2>
      <section className="settings-card settings-list device-list">
        {loading && devices.length === 0 ? (
          <div className="device-list__loading">
            <Spinner />
          </div>
        ) : (
          devices.map((d) => (
            <DeviceRow
              key={d.deviceId}
              device={d}
              canVerify={verified && !d.isCurrent && d.verified === false}
              onVerify={() => {
                const crypto = client.getCrypto();
                if (crypto) showVerification(crypto.requestDeviceVerification(client.getUserId()!, d.deviceId));
              }}
              onSignOut={() => setSignOut(d)}
            />
          ))
        )}
      </section>
      <ConfirmDialog
        open={!!signOut}
        title={`Sign out “${signOut?.displayName ?? ""}”?`}
        message="That device will be signed out and won't receive new messages anymore."
        confirmLabel="Sign out device"
        danger
        onClose={() => setSignOut(null)}
        onConfirm={async () => {
          if (!signOut) return;
          try {
            await deleteDevice(client, signOut.deviceId);
            toast.show("Device signed out", "success");
            refresh();
          } catch (e) {
            if (!(e instanceof UserCancelledError)) toast.error(e, "Could not sign out device");
          }
        }}
      />
    </>
  );
}

function deviceIcon(name: string) {
  if (/android|ios|iphone|ipad|mobile/i.test(name)) return <Smartphone size={20} />;
  return <Laptop size={20} />;
}

function DeviceRow({
  device,
  canVerify,
  onVerify,
  onSignOut,
}: {
  device: DeviceSummary;
  canVerify: boolean;
  onVerify: () => void;
  onSignOut: () => void;
}) {
  const seen = device.lastSeenTs ? new Date(device.lastSeenTs).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <div className="device-row">
      <span className={`device-row__icon ${device.verified ? "is-verified" : device.verified === false ? "is-unverified" : ""}`}>
        {deviceIcon(device.displayName)}
        {device.verified && <CircleCheck size={14} className="device-row__check" />}
      </span>
      <div className="device-row__text">
        <span className="device-row__name">
          {device.displayName}
          {device.isCurrent && <span className="pill pill--accent">This device</span>}
        </span>
        <small>
          {device.verified ? (
            <span className="text-success">Verified</span>
          ) : device.verified === false ? (
            <span className="text-warning">Not verified</span>
          ) : (
            <span>No encryption</span>
          )}
          {" · "}
          <code>{device.deviceId}</code>
          {seen && !device.isCurrent && <> · Last active {seen}</>}
        </small>
      </div>
      <div className="device-row__actions">
        {canVerify && (
          <Button size="sm" variant="secondary" icon={<ShieldCheck size={15} />} onClick={onVerify}>
            Verify
          </Button>
        )}
        {!device.isCurrent && (
          <Button size="sm" variant="ghost" icon={<LogOut size={15} />} onClick={onSignOut} aria-label={`Sign out ${device.displayName}`} title="Sign out device" />
        )}
      </div>
    </div>
  );
}

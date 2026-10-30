import { useEffect, useMemo, useState } from "react";
import { KnownMembership } from "matrix-js-sdk";
import { ArrowLeft, Ban, Copy, MessageCircle, ShieldAlert, ShieldCheck, ShieldQuestion, Star, StarOff, Users } from "lucide-react";
import { useMatrix } from "../matrix/MatrixContext";
import { useContacts, useIgnoredUsers, useProfile, useRoomSummaries } from "../matrix/hooks";
import { addContact, isSavedContact, removeContact } from "../matrix/contacts";
import { startDirectChat } from "../matrix/rooms";
import { useMediaUrl } from "../matrix/media";
import { navigate } from "../router";
import { Avatar } from "../components/Avatar";
import { Button, IconButton, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Lightbox, type LightboxImage } from "../components/Lightbox";
import { useToast } from "../components/Toast";
import { useIsCompact } from "./AppShell";
import { useSecurity } from "../components/Security";
import { notifySecurityChanged, useUserVerification } from "../matrix/security";

export function ContactProfile({ userId }: { userId: string }) {
  const { client, cryptoEnabled } = useMatrix();
  const toast = useToast();
  const compact = useIsCompact();
  const profile = useProfile(userId);
  const contacts = useContacts();
  const ignored = useIgnoredUsers();
  const rooms = useRoomSummaries();
  const [busy, setBusy] = useState<"chat" | "contact" | "verify" | null>(null);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);
  const backdrop = useMediaUrl(profile?.avatarMxc, { width: 96, height: 96 });

  const me = client.getUserId();
  const isMe = userId === me;
  const saved = isSavedContact(client, userId);
  const isContact = contacts.includes(userId);
  const blocked = ignored.includes(userId);
  const name = profile?.displayName ?? userId;
  const user = client.getUser(userId);
  const online = user?.presence === "online";

  const security = useSecurity();
  const verification = useUserVerification(client, cryptoEnabled ? userId : null);
  const [hasKeys, setHasKeys] = useState<boolean | null>(null);
  useEffect(() => {
    const crypto = client.getCrypto();
    if (!crypto || isMe) return;
    let alive = true;
    crypto
      .userHasCrossSigningKeys(userId, true)
      .then((v) => alive && setHasKeys(v))
      .catch(() => alive && setHasKeys(false));
    return () => {
      alive = false;
    };
  }, [client, userId, isMe, verification]);
  const verified = !!verification?.isCrossSigningVerified();
  const identityChanged = !!verification?.wasCrossSigningVerified() && !verified;

  const verify = async () => {
    const crypto = client.getCrypto();
    if (!crypto) return;
    setBusy("verify");
    try {
      const roomId = await startDirectChat(client, userId, cryptoEnabled);
      security.showVerification(crypto.requestVerificationDM(userId, roomId));
    } catch (e) {
      toast.error(e, "Could not start verification");
    } finally {
      setBusy(null);
    }
  };

  const acceptIdentity = async () => {
    try {
      await client.getCrypto()?.withdrawVerificationRequirement(userId);
      notifySecurityChanged();
    } catch (e) {
      toast.error(e);
    }
  };

  const sharedGroups = useMemo(
    () =>
      rooms.filter(
        (r) => !r.isDirect && !r.isInvite && r.room.getMember(userId)?.membership === KnownMembership.Join,
      ),
    [rooms, userId],
  );

  const message = async () => {
    setBusy("chat");
    try {
      const roomId = await startDirectChat(client, userId, cryptoEnabled);
      navigate({ section: "chats", roomId });
    } catch (e) {
      toast.error(e, "Could not open chat");
    } finally {
      setBusy(null);
    }
  };

  const toggleContact = async () => {
    setBusy("contact");
    try {
      if (saved) {
        await removeContact(client, userId);
        toast.show("Removed from contacts");
      } else {
        await addContact(client, userId);
        toast.show("Added to contacts", "success");
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="profile-page">
      <div className="profile-page__backdrop" style={backdrop ? { backgroundImage: `url(${backdrop})` } : undefined} />
      <header className="profile-page__header">
        {compact && (
          <IconButton label="Back" onClick={() => window.history.length > 1 ? window.history.back() : navigate({ section: "contacts" })}>
            <ArrowLeft size={22} />
          </IconButton>
        )}
      </header>
      <div className="profile-page__scroll">
        <div className="profile-card">
          <Avatar
            mxc={profile?.avatarMxc}
            name={name}
            id={userId}
            size={128}
            online={user?.presence ? online : undefined}
            onClick={profile?.avatarMxc ? () => setLightbox({ mxc: profile.avatarMxc!, name }) : undefined}
          />
          <h1>{name}</h1>
          <button
            className="profile-card__id"
            onClick={async () => {
              await navigator.clipboard?.writeText(userId);
              toast.show("Matrix ID copied", "success");
            }}
            title="Copy Matrix ID"
          >
            {userId} <Copy size={14} />
          </button>
          {user?.presence && user.presence !== "offline" && (
            <span className={`pill ${online ? "pill--success" : ""}`}>{online ? "Online" : user.presence === "unavailable" ? "Away" : user.presence}</span>
          )}
          {!isMe && verified && (
            <span className="pill trust--verified">
              <ShieldCheck size={13} /> Verified
            </span>
          )}
          {!isMe && identityChanged && (
            <span className="pill trust--warning">
              <ShieldAlert size={13} /> Identity changed
            </span>
          )}
          {isContact && !isMe && (
            <span className="pill pill--accent">
              <Users size={13} /> {saved ? "Saved contact" : "Direct chat partner"}
            </span>
          )}

          {!isMe && (
            <div className="profile-card__actions">
              <button className="action-tile action-tile--primary" onClick={message} disabled={!!busy || blocked}>
                {busy === "chat" ? <Spinner size={20} /> : <MessageCircle size={22} />}
                <span>Message</span>
              </button>
              <button className="action-tile" onClick={toggleContact} disabled={!!busy}>
                {busy === "contact" ? <Spinner size={20} /> : saved ? <StarOff size={22} /> : <Star size={22} />}
                <span>{saved ? "Remove" : "Add contact"}</span>
              </button>
              <button className={`action-tile ${blocked ? "" : "action-tile--danger"}`} onClick={() => setConfirmBlock(true)}>
                <Ban size={22} />
                <span>{blocked ? "Unblock" : "Block"}</span>
              </button>
            </div>
          )}
        </div>

        {!isMe && cryptoEnabled && verification && (
          <section className="info-card profile-section">
            <div className="profile-trust">
              {verified ? (
                <ShieldCheck size={26} className="text-success" />
              ) : identityChanged ? (
                <ShieldAlert size={26} className="text-warning" />
              ) : (
                <ShieldQuestion size={26} className="muted" />
              )}
              <div className="profile-trust__text">
                <strong>{verified ? "Verified" : identityChanged ? "Identity changed" : "Not verified"}</strong>
                <small>
                  {verified
                    ? `You've confirmed ${name}'s identity. Messages are end-to-end encrypted.`
                    : identityChanged
                      ? `${name}'s identity was reset. This can happen if they reinstalled — verify again to be sure.`
                      : hasKeys === false
                        ? `${name} hasn't set up encryption keys yet, so they can't be verified.`
                        : `Compare emoji with ${name} to make sure you're talking to the right person.`}
                </small>
              </div>
              {!verified && hasKeys !== false && (
                <Button variant={identityChanged ? "secondary" : "primary"} size="sm" onClick={verify} loading={busy === "verify"}>
                  Verify
                </Button>
              )}
            </div>
            {identityChanged && (
              <button className="link-btn" style={{ marginTop: 10 }} onClick={acceptIdentity}>
                Accept new identity without verifying
              </button>
            )}
          </section>
        )}

        {sharedGroups.length > 0 && (
          <section className="info-card info-card--flush profile-section">
            <div className="info-card__head">
              <span className="info-card__label">
                {isMe ? "Your groups" : "Groups in common"} · {sharedGroups.length}
              </span>
            </div>
            {sharedGroups.map((g) => (
              <button key={g.roomId} className="member-row__main member-row--btn" onClick={() => navigate({ section: "chats", roomId: g.roomId })}>
                <Avatar mxc={g.avatarMxc} name={g.name} id={g.roomId} size={40} />
                <span className="member-row__text">
                  <span className="member-row__name">{g.name}</span>
                  <span className="member-row__id">
                    <Users size={12} /> {g.memberCount} members
                  </span>
                </span>
              </button>
            ))}
          </section>
        )}
      </div>

      <ConfirmDialog
        open={confirmBlock}
        title={blocked ? `Unblock ${name}?` : `Block ${name}?`}
        message={
          blocked
            ? "You will see their messages and invites again."
            : "You won't see messages or invites from this person anywhere. They won't be notified."
        }
        confirmLabel={blocked ? "Unblock" : "Block"}
        danger={!blocked}
        onClose={() => setConfirmBlock(false)}
        onConfirm={async () => {
          const list = client.getIgnoredUsers();
          const next = blocked ? list.filter((u) => u !== userId) : [...list, userId];
          try {
            await client.setIgnoredUsers(next);
            toast.show(blocked ? "User unblocked" : "User blocked", "success");
          } catch (e) {
            toast.error(e);
          }
        }}
      />
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

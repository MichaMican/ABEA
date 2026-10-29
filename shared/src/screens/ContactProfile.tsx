import { useMemo, useState } from "react";
import { KnownMembership } from "matrix-js-sdk";
import { ArrowLeft, Ban, Copy, MessageCircle, ShieldCheck, Star, StarOff, Users } from "lucide-react";
import { useMatrix } from "../matrix/MatrixContext";
import { useContacts, useIgnoredUsers, useProfile, useRoomSummaries } from "../matrix/hooks";
import { addContact, isSavedContact, removeContact } from "../matrix/contacts";
import { startDirectChat } from "../matrix/rooms";
import { useMediaUrl } from "../matrix/media";
import { navigate } from "../router";
import { Avatar } from "../components/Avatar";
import { IconButton, Spinner } from "../components/ui";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Lightbox, type LightboxImage } from "../components/Lightbox";
import { useToast } from "../components/Toast";
import { useIsCompact } from "./AppShell";

export function ContactProfile({ userId }: { userId: string }) {
  const { client, cryptoEnabled } = useMatrix();
  const toast = useToast();
  const compact = useIsCompact();
  const profile = useProfile(userId);
  const contacts = useContacts();
  const ignored = useIgnoredUsers();
  const rooms = useRoomSummaries();
  const [busy, setBusy] = useState<"chat" | "contact" | null>(null);
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
          {isContact && !isMe && (
            <span className="pill pill--accent">
              <ShieldCheck size={13} /> {saved ? "Saved contact" : "Direct chat partner"}
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

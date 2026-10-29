import { useEffect, useMemo, useState } from "react";
import { EventType, KnownMembership, RoomStateEvent, type RoomMember } from "matrix-js-sdk";
import { ArrowLeft, Check, LogOut, Lock, LockOpen, MessageCircle, Pencil, UserMinus, UserPlus, UserRound, X } from "lucide-react";
import { useMatrixClient } from "../matrix/MatrixContext";
import { useClientVersion, useRoom, useRoomSummary } from "../matrix/hooks";
import { leaveRoom } from "../matrix/rooms";
import { uploadAvatar } from "../matrix/media";
import { navigate } from "../router";
import { Avatar } from "../components/Avatar";
import { AvatarPicker } from "../components/AvatarPicker";
import { Button, IconButton, Modal, Spinner } from "../components/ui";
import { UserPicker } from "../components/UserPicker";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Lightbox, type LightboxImage } from "../components/Lightbox";
import { useToast } from "../components/Toast";
import { useIsCompact } from "./AppShell";

export function RoomInfo({ roomId }: { roomId: string }) {
  const client = useMatrixClient();
  const toast = useToast();
  const compact = useIsCompact();
  const room = useRoom(roomId);
  const summary = useRoomSummary(room);
  const membersVersion = useClientVersion([RoomStateEvent.Members, RoomStateEvent.NewMember, RoomStateEvent.Events]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [kickTarget, setKickTarget] = useState<RoomMember | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [lightbox, setLightbox] = useState<LightboxImage | null>(null);

  useEffect(() => {
    if (!room) return;
    setLoadingMembers(true);
    room
      .loadMembersIfNeeded()
      .catch(() => undefined)
      .finally(() => setLoadingMembers(false));
  }, [room]);

  const me = client.getUserId() ?? "";
  const members = useMemo(() => {
    void membersVersion;
    if (!room) return [];
    return room
      .getMembers()
      .filter((m) => m.membership === KnownMembership.Join || m.membership === KnownMembership.Invite)
      .sort((a, b) => {
        if (a.membership !== b.membership) return a.membership === KnownMembership.Join ? -1 : 1;
        if (b.powerLevel !== a.powerLevel) return b.powerLevel - a.powerLevel;
        return a.name.localeCompare(b.name);
      });
  }, [room, membersVersion]);

  if (!room || !summary) return null;

  const close = () => navigate({ section: "chats", roomId }, { replace: true });
  const state = room.currentState;
  const canEditAvatar = !summary.isDirect && state.maySendStateEvent(EventType.RoomAvatar, me);
  const canEditName = !summary.isDirect && state.maySendStateEvent(EventType.RoomName, me);
  const canEditTopic = !summary.isDirect && state.maySendStateEvent(EventType.RoomTopic, me);
  const canInvite = room.canInvite(me);
  const myLevel = room.getMember(me)?.powerLevel ?? 0;
  const kickLevel = (state.getStateEvents(EventType.RoomPowerLevels, "")?.getContent().kick as number | undefined) ?? 50;
  const topic = state.getStateEvents(EventType.RoomTopic, "")?.getContent().topic as string | undefined;
  const joined = members.filter((m) => m.membership === KnownMembership.Join).length;

  return (
    <div className="info-panel">
      <header className="info-panel__header">
        <IconButton label={compact ? "Back" : "Close"} onClick={close}>
          {compact ? <ArrowLeft size={22} /> : <X size={20} />}
        </IconButton>
        <h2>{summary.isDirect ? "Chat info" : "Group info"}</h2>
      </header>
      <div className="info-panel__scroll">
        <div className="info-hero">
          <AvatarPicker
            mxc={summary.avatarMxc}
            name={summary.name}
            id={summary.partnerId ?? summary.roomId}
            size={112}
            editable={canEditAvatar}
            busy={avatarBusy}
            onView={summary.avatarMxc ? () => setLightbox({ mxc: summary.avatarMxc!, name: summary.name }) : undefined}
            onPick={async (file) => {
              setAvatarBusy(true);
              try {
                const url = await uploadAvatar(client, file);
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await client.sendStateEvent(room.roomId, EventType.RoomAvatar, { url } as any, "");
                toast.show("Group picture updated", "success");
              } catch (e) {
                toast.error(e, "Could not update picture");
              } finally {
                setAvatarBusy(false);
              }
            }}
          />
          <EditableText
            value={summary.name}
            editable={canEditName}
            className="info-hero__name"
            placeholder="Group name"
            onSave={(v) => client.setRoomName(room.roomId, v).then(() => undefined)}
          />
          <div className="info-hero__sub">
            {summary.isDirect ? summary.partnerId : `Group · ${joined} member${joined === 1 ? "" : "s"}`}
          </div>
        </div>

        {summary.isDirect && summary.partnerId && (
          <div className="action-row">
            <button className="action-tile" onClick={() => navigate({ section: "contacts", userId: summary.partnerId! })}>
              <UserRound size={20} />
              <span>Profile</span>
            </button>
          </div>
        )}

        {!summary.isDirect && (canEditTopic || topic) && (
          <section className="info-card">
            <div className="info-card__label">Topic</div>
            <EditableText
              value={topic ?? ""}
              editable={canEditTopic}
              multiline
              placeholder="Add a topic"
              onSave={(v) => client.setRoomTopic(room.roomId, v).then(() => undefined)}
            />
          </section>
        )}

        <section className="info-card info-card--row">
          {summary.encrypted ? <Lock size={18} className="text-success" /> : <LockOpen size={18} className="muted" />}
          <div>
            <div className="info-card__title">{summary.encrypted ? "End-to-end encrypted" : "Not encrypted"}</div>
            <div className="info-card__desc">
              {summary.encrypted
                ? "Messages are secured with keys only the participants have."
                : "Messages are stored on the server without end-to-end encryption."}
            </div>
          </div>
        </section>

        {!summary.isDirect && (
          <section className="info-card info-card--flush">
            <div className="info-card__head">
              <span className="info-card__label">Members · {members.length}</span>
              {canInvite && (
                <Button size="sm" variant="subtle" icon={<UserPlus size={16} />} onClick={() => setInviteOpen(true)}>
                  Add
                </Button>
              )}
            </div>
            {loadingMembers && members.length === 0 ? (
              <div className="center-fill">
                <Spinner size={20} />
              </div>
            ) : (
              members.map((m) => {
                const canKick = m.userId !== me && myLevel >= kickLevel && m.powerLevel < myLevel;
                return (
                  <div key={m.userId} className="member-row">
                    <button className="member-row__main" onClick={() => navigate({ section: "contacts", userId: m.userId })}>
                      <Avatar mxc={m.getMxcAvatarUrl()} name={m.name} id={m.userId} size={40} />
                      <span className="member-row__text">
                        <span className="member-row__name">
                          {m.name}
                          {m.userId === me && <span className="muted"> (you)</span>}
                        </span>
                        <span className="member-row__id">{m.membership === KnownMembership.Invite ? "Invited" : m.userId}</span>
                      </span>
                      {m.powerLevel >= 100 ? (
                        <span className="role role--admin">Admin</span>
                      ) : m.powerLevel >= 50 ? (
                        <span className="role role--mod">Mod</span>
                      ) : null}
                    </button>
                    {canKick && (
                      <IconButton label={`Remove ${m.name}`} size="sm" onClick={() => setKickTarget(m)}>
                        <UserMinus size={17} />
                      </IconButton>
                    )}
                  </div>
                );
              })
            )}
          </section>
        )}

        <section className="info-card info-card--flush">
          {summary.isDirect && summary.partnerId && (
            <button className="list-action" onClick={() => navigate({ section: "chats", roomId })}>
              <MessageCircle size={19} /> Back to conversation
            </button>
          )}
          <button className="list-action list-action--danger" onClick={() => setConfirmLeave(true)}>
            <LogOut size={19} /> {summary.isDirect ? "Delete chat" : "Leave group"}
          </button>
        </section>
      </div>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Add members" className="modal--picker">
        <InvitePicker
          roomId={roomId}
          exclude={members.map((m) => m.userId)}
          onDone={() => setInviteOpen(false)}
        />
      </Modal>
      <ConfirmDialog
        open={confirmLeave}
        title={summary.isDirect ? "Delete this chat?" : "Leave this group?"}
        message={
          summary.isDirect
            ? `You will leave the conversation with ${summary.name}. They can still see the message history.`
            : `You will no longer receive messages from “${summary.name}”.`
        }
        confirmLabel={summary.isDirect ? "Delete chat" : "Leave"}
        danger
        onClose={() => setConfirmLeave(false)}
        onConfirm={async () => {
          try {
            await leaveRoom(client, roomId);
            navigate({ section: "chats" }, { replace: true });
          } catch (e) {
            toast.error(e);
          }
        }}
      />
      <ConfirmDialog
        open={!!kickTarget}
        title={`Remove ${kickTarget?.name ?? ""}?`}
        message="They will be removed from the group and can only rejoin if invited again."
        confirmLabel="Remove"
        danger
        onClose={() => setKickTarget(null)}
        onConfirm={async () => {
          if (!kickTarget) return;
          try {
            await client.kick(roomId, kickTarget.userId);
          } catch (e) {
            toast.error(e);
          }
        }}
      />
      <Lightbox image={lightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}

function InvitePicker({ roomId, exclude, onDone }: { roomId: string; exclude: string[]; onDone: () => void }) {
  const client = useMatrixClient();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <UserPicker
        selected={selected}
        exclude={exclude}
        onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
      />
      <div className="modal__inline-footer">
        <Button
          block
          disabled={selected.length === 0}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            const results = await Promise.allSettled(selected.map((id) => client.invite(roomId, id)));
            setBusy(false);
            const failed = results.filter((r) => r.status === "rejected");
            if (failed.length) toast.error((failed[0] as PromiseRejectedResult).reason, "Some invites failed");
            else toast.show(`Invited ${selected.length} ${selected.length === 1 ? "person" : "people"}`, "success");
            onDone();
          }}
        >
          {selected.length ? `Invite ${selected.length}` : "Invite"}
        </Button>
      </div>
    </>
  );
}

export function EditableText({
  value,
  editable,
  onSave,
  placeholder,
  multiline,
  className,
}: {
  value: string;
  editable: boolean;
  onSave: (value: string) => Promise<void>;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = async () => {
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className={`editable ${className ?? ""} ${!value ? "is-empty" : ""}`}>
        <span className="editable__value">{value || placeholder}</span>
        {editable && (
          <IconButton label="Edit" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={15} />
          </IconButton>
        )}
      </div>
    );
  }
  const Input = multiline ? "textarea" : "input";
  return (
    <div className={`editable is-editing ${className ?? ""}`}>
      <Input
        className="editable__input"
        value={draft}
        autoFocus
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
            e.preventDefault();
            void save();
          } else if (e.key === "Escape") setEditing(false);
        }}
      />
      <IconButton label="Save" size="sm" variant="primary" onClick={() => void save()} disabled={busy}>
        {busy ? <Spinner size={14} /> : <Check size={16} />}
      </IconButton>
      <IconButton label="Cancel" size="sm" onClick={() => setEditing(false)} disabled={busy}>
        <X size={16} />
      </IconButton>
    </div>
  );
}

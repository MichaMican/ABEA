import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, IconButton, Modal, Switch, TextField } from "../components/ui";
import { UserPicker } from "../components/UserPicker";
import { AvatarPicker } from "../components/AvatarPicker";
import { useMatrix } from "../matrix/MatrixContext";
import { createGroupChat } from "../matrix/rooms";
import { uploadAvatar } from "../matrix/media";
import { navigate } from "../router";
import { useToast } from "../components/Toast";

export function NewGroupDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client, cryptoEnabled } = useMatrix();
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [members, setMembers] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [avatar, setAvatar] = useState<File | null>(null);
  const [encrypted, setEncrypted] = useState(cryptoEnabled);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep(1);
      setMembers([]);
      setName("");
      setTopic("");
      setAvatar(null);
      setEncrypted(cryptoEnabled);
    }
  }, [open, cryptoEnabled]);

  const toggle = (id: string) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const avatarUrl = avatar ? await uploadAvatar(client, avatar) : undefined;
      const roomId = await createGroupChat(client, { name, topic, avatarUrl, invite: members, encrypted });
      toast.show(`Created “${name.trim()}”`, "success");
      onClose();
      navigate({ section: "chats", roomId });
    } catch (e) {
      toast.error(e, "Could not create the group");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      className="modal--picker"
      title={
        step === 1 ? (
          "Add members"
        ) : (
          <span className="modal__title-with-back">
            <IconButton label="Back" size="sm" onClick={() => setStep(1)}>
              <ArrowLeft size={18} />
            </IconButton>
            Group details
          </span>
        )
      }
      footer={
        step === 1 ? (
          <>
            <span className="modal__footer-note">
              {members.length === 0 ? "You can also add people later" : `${members.length} selected`}
            </span>
            <Button onClick={() => setStep(2)}>Next</Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setStep(1)} disabled={busy}>
              Back
            </Button>
            <Button onClick={create} loading={busy} disabled={!name.trim()}>
              Create group
            </Button>
          </>
        )
      }
    >
      {step === 1 ? (
        <UserPicker selected={members} onToggle={toggle} />
      ) : (
        <div className="group-form">
          <div className="group-form__top">
            <AvatarPicker previewFile={avatar} name={name || "Group"} id={name || "group"} size={88} onPick={setAvatar} />
            <TextField
              label="Group name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Weekend trip 🏕️"
              autoFocus
              maxLength={80}
              onKeyDown={(e) => e.key === "Enter" && create()}
            />
          </div>
          <TextField label="Topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What's this group about?" />
          <Switch
            checked={encrypted}
            onChange={setEncrypted}
            disabled={!cryptoEnabled}
            label="End-to-end encryption"
            description={
              cryptoEnabled
                ? "Only members can read messages. This can't be turned off later."
                : "Encryption is not available on this device."
            }
          />
          {members.length > 0 && (
            <div className="group-form__members">
              {members.length} {members.length === 1 ? "person" : "people"} will be invited
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

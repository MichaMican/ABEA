import { useState } from "react";
import { Modal } from "../components/ui";
import { UserPicker } from "../components/UserPicker";
import { useMatrix } from "../matrix/MatrixContext";
import { startDirectChat } from "../matrix/rooms";
import { navigate } from "../router";
import { useToast } from "../components/Toast";
import { Spinner } from "../components/ui";

export function NewChatDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { client, cryptoEnabled } = useMatrix();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const start = async (userId: string) => {
    if (busy) return;
    setBusy(userId);
    try {
      const roomId = await startDirectChat(client, userId, cryptoEnabled);
      onClose();
      navigate({ section: "chats", roomId });
    } catch (e) {
      toast.error(e, "Could not start the chat");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="New chat" size="md" className="modal--picker">
      <UserPicker selected={busy ? [busy] : []} onToggle={start} multi={false} />
      {busy && (
        <div className="modal__overlay">
          <Spinner size={28} />
          <span>Starting chat…</span>
        </div>
      )}
    </Modal>
  );
}

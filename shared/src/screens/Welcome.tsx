import { useState } from "react";
import { MessageSquarePlus, Users, UserPlus } from "lucide-react";
import { Logo } from "../components/Logo";
import { useMatrixClient } from "../matrix/MatrixContext";
import { useProfile } from "../matrix/hooks";
import { navigate } from "../router";
import { NewChatDialog } from "./NewChatDialog";
import { NewGroupDialog } from "./NewGroupDialog";

export function Welcome() {
  const client = useMatrixClient();
  const me = useProfile(client.getUserId());
  const [dialog, setDialog] = useState<"chat" | "group" | null>(null);
  const first = me?.displayName.split(" ")[0];
  return (
    <div className="welcome">
      <div className="welcome__glow" aria-hidden="true" />
      <div className="welcome__content">
        <Logo size={76} />
        <h2>{first ? `Hi ${first}, welcome to ABEA` : "Welcome to ABEA"}</h2>
        <p>Pick a conversation from the list, or start something new.</p>
        <div className="welcome__actions">
          <button className="action-card" onClick={() => setDialog("chat")}>
            <span className="action-card__icon action-card__icon--violet">
              <MessageSquarePlus size={22} />
            </span>
            <span className="action-card__title">New chat</span>
            <span className="action-card__desc">Message someone directly</span>
          </button>
          <button className="action-card" onClick={() => setDialog("group")}>
            <span className="action-card__icon action-card__icon--blue">
              <Users size={22} />
            </span>
            <span className="action-card__title">New group</span>
            <span className="action-card__desc">Chat with several people</span>
          </button>
          <button className="action-card" onClick={() => navigate({ section: "contacts" })}>
            <span className="action-card__icon action-card__icon--teal">
              <UserPlus size={22} />
            </span>
            <span className="action-card__title">Contacts</span>
            <span className="action-card__desc">Find & manage people</span>
          </button>
        </div>
      </div>
      <NewChatDialog open={dialog === "chat"} onClose={() => setDialog(null)} />
      <NewGroupDialog open={dialog === "group"} onClose={() => setDialog(null)} />
    </div>
  );
}

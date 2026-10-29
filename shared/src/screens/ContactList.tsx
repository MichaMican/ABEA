import { useMemo, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { useMatrixClient } from "../matrix/MatrixContext";
import { useContacts, useProfile } from "../matrix/hooks";
import { addContact } from "../matrix/contacts";
import { navigate } from "../router";
import { Avatar } from "../components/Avatar";
import { EmptyState, IconButton, Modal, SearchField, Spinner } from "../components/ui";
import { quickName, UserPicker } from "../components/UserPicker";
import { useToast } from "../components/Toast";

export function ContactList({ activeUserId }: { activeUserId?: string }) {
  const client = useMatrixClient();
  const contacts = useContacts();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = contacts
      .map((id) => ({ id, name: quickName(client, id) }))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    const map = new Map<string, typeof list>();
    for (const c of list) {
      const first = c.name.trim().charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      if (!map.has(letter)) map.set(letter, []);
      map.get(letter)!.push(c);
    }
    return [...map.entries()].sort(([a], [b]) => (a === "#" ? 1 : b === "#" ? -1 : a.localeCompare(b)));
  }, [client, contacts, query]);

  return (
    <div className="list-pane">
      <header className="list-pane__header">
        <h1>Contacts</h1>
        <div className="list-pane__actions">
          <IconButton label="Add contact" variant="primary" onClick={() => setAdding(true)}>
            <UserPlus size={20} />
          </IconButton>
        </div>
      </header>
      <div className="list-pane__search">
        <SearchField value={query} onChange={setQuery} placeholder="Search contacts" />
      </div>
      <div className="list-pane__scroll">
        {contacts.length > 0 && (
          <div className="list-section-title">
            {contacts.length} contact{contacts.length === 1 ? "" : "s"}
          </div>
        )}
        {groups.map(([letter, people]) => (
          <div key={letter} className="contact-group">
            <div className="contact-group__letter">{letter}</div>
            {people.map((c) => (
              <ContactRow key={c.id} userId={c.id} active={c.id === activeUserId} />
            ))}
          </div>
        ))}
        {contacts.length === 0 ? (
          <EmptyState
            icon={<Users size={30} />}
            title="No contacts yet"
            description="Add people by their Matrix ID. Everyone you chat with directly shows up here too."
            action={
              <button className="link-btn" onClick={() => setAdding(true)}>
                Add your first contact
              </button>
            }
          />
        ) : (
          groups.length === 0 && <EmptyState title="No matches" description="No contacts match your search." />
        )}
      </div>
      <AddContactDialog open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function ContactRow({ userId, active }: { userId: string; active: boolean }) {
  const profile = useProfile(userId);
  const name = profile?.displayName ?? userId;
  return (
    <button className={`person-row person-row--list ${active ? "is-active" : ""}`} onClick={() => navigate({ section: "contacts", userId })}>
      <Avatar mxc={profile?.avatarMxc} name={name} id={userId} size={44} />
      <span className="person-row__text">
        <span className="person-row__name">{name}</span>
        <span className="person-row__id">{userId}</span>
      </span>
    </button>
  );
}

export function AddContactDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useMatrixClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Modal open={open} onClose={onClose} title="Add contact" className="modal--picker">
      <UserPicker
        multi={false}
        selected={busy ? [busy] : []}
        onToggle={async (userId) => {
          if (busy) return;
          setBusy(userId);
          try {
            await addContact(client, userId);
            toast.show("Contact added", "success");
            onClose();
            navigate({ section: "contacts", userId });
          } catch (e) {
            toast.error(e, "Could not add contact");
          } finally {
            setBusy(null);
          }
        }}
      />
      {busy && (
        <div className="modal__overlay">
          <Spinner size={28} />
        </div>
      )}
    </Modal>
  );
}

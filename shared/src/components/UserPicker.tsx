import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, X } from "lucide-react";
import type { MatrixClient } from "matrix-js-sdk";
import { useMatrixClient } from "../matrix/MatrixContext";
import { useContacts, useProfile } from "../matrix/hooks";
import { isValidUserId } from "../matrix/contacts";
import { Avatar } from "./Avatar";
import { SearchField, Spinner } from "./ui";

interface DirectoryUser {
  user_id: string;
  display_name?: string;
  avatar_url?: string;
}

/** Best-effort local display name lookup used for filtering without network requests. */
export function quickName(client: MatrixClient, userId: string): string {
  const user = client.getUser(userId);
  if (user?.displayName && user.displayName !== userId) return user.displayName;
  for (const room of client.getRooms()) {
    const m = room.getMember(userId);
    if (m?.rawDisplayName && m.rawDisplayName !== userId) return m.rawDisplayName;
  }
  return userId.replace(/^@/, "").split(":")[0];
}

export function UserPicker({
  selected,
  onToggle,
  multi = true,
  exclude = [],
  autoFocus = true,
  placeholder = "Search name or @user:server",
}: {
  selected: string[];
  onToggle: (userId: string) => void;
  multi?: boolean;
  exclude?: string[];
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const client = useMatrixClient();
  const contacts = useContacts();
  const me = client.getUserId();
  const [query, setQuery] = useState("");
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setDirectory([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await client.searchUserDirectory({ term, limit: 20 });
        if (!cancelled) setDirectory(res.results as DirectoryUser[]);
      } catch {
        if (!cancelled) setDirectory([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const excluded = new Set([...exclude, me ?? ""]);
    const seen = new Set<string>();
    const out: { userId: string; source: "contact" | "directory" | "direct" }[] = [];
    const push = (userId: string, source: "contact" | "directory" | "direct") => {
      if (excluded.has(userId) || seen.has(userId)) return;
      seen.add(userId);
      out.push({ userId, source });
    };
    if (isValidUserId(query)) push(query.trim(), "direct");
    contacts
      .filter((id) => !q || id.toLowerCase().includes(q) || quickName(client, id).toLowerCase().includes(q))
      .sort((a, b) => quickName(client, a).localeCompare(quickName(client, b)))
      .forEach((id) => push(id, "contact"));
    directory.forEach((u) => push(u.user_id, "directory"));
    return out;
  }, [client, contacts, directory, exclude, me, query]);

  return (
    <div className="user-picker">
      <SearchField value={query} onChange={setQuery} placeholder={placeholder} autoFocus={autoFocus} />
      {multi && selected.length > 0 && (
        <div className="user-picker__chips">
          {selected.map((id) => (
            <SelectedChip key={id} userId={id} onRemove={() => onToggle(id)} />
          ))}
        </div>
      )}
      <div className="user-picker__results">
        {results.length === 0 && !searching && (
          <div className="user-picker__empty">
            {query.trim()
              ? "No people found. Enter a full Matrix ID like @alice:matrix.org"
              : "Search for people by name or Matrix ID"}
          </div>
        )}
        {results.map((r, i) => {
          const showHeader = i === 0 || results[i - 1].source !== r.source;
          return (
            <div key={r.userId}>
              {showHeader && (
                <div className="list-section-title">
                  {r.source === "contact" ? "Contacts" : r.source === "directory" ? "Directory" : "Matrix ID"}
                </div>
              )}
              <UserRow
                userId={r.userId}
                hint={directory.find((d) => d.user_id === r.userId)}
                selected={selected.includes(r.userId)}
                multi={multi}
                onClick={() => onToggle(r.userId)}
              />
            </div>
          );
        })}
        {searching && (
          <div className="user-picker__loading">
            <Spinner size={18} />
          </div>
        )}
      </div>
    </div>
  );
}

function SelectedChip({ userId, onRemove }: { userId: string; onRemove: () => void }) {
  const profile = useProfile(userId);
  return (
    <button className="person-chip" onClick={onRemove} title="Remove">
      <Avatar mxc={profile?.avatarMxc} name={profile?.displayName ?? userId} id={userId} size={22} />
      <span>{profile?.displayName ?? userId}</span>
      <X size={14} />
    </button>
  );
}

function UserRow({
  userId,
  selected,
  onClick,
  hint,
  multi,
}: {
  userId: string;
  selected: boolean;
  multi: boolean;
  onClick: () => void;
  hint?: DirectoryUser;
}) {
  const profile = useProfile(userId);
  const name = profile?.displayName ?? hint?.display_name ?? userId;
  const avatar = profile?.avatarMxc ?? hint?.avatar_url ?? null;
  return (
    <button className={`person-row ${selected ? "is-selected" : ""}`} onClick={onClick}>
      <Avatar mxc={avatar} name={name} id={userId} size={40} />
      <span className="person-row__text">
        <span className="person-row__name">{name}</span>
        <span className="person-row__id">{userId}</span>
      </span>
      {multi ? (
        <span className={`check ${selected ? "is-checked" : ""}`}>{selected && <Check size={14} strokeWidth={3} />}</span>
      ) : selected ? (
        <Spinner size={16} />
      ) : (
        <ChevronRight size={18} className="person-row__chevron" />
      )}
    </button>
  );
}

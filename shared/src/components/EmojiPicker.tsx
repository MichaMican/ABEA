import { useState } from "react";
import { EMOJI_CATEGORIES } from "../lib/emoji";

const RECENT_KEY = "abea.recentEmoji";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string): void {
  const list = [emoji, ...loadRecent().filter((e) => e !== emoji)].slice(0, 24);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const recent = loadRecent();
  const categories = recent.length
    ? [{ id: "recent", label: "Recently used", icon: "🕘", emojis: recent }, ...EMOJI_CATEGORIES]
    : EMOJI_CATEGORIES;
  const [active, setActive] = useState(categories[0].id);
  const current = categories.find((c) => c.id === active) ?? categories[0];
  return (
    <div className="emoji-picker">
      <div className="emoji-picker__tabs">
        {categories.map((c) => (
          <button
            key={c.id}
            className={c.id === current.id ? "is-active" : ""}
            onClick={() => setActive(c.id)}
            title={c.label}
            aria-label={c.label}
          >
            {c.icon}
          </button>
        ))}
      </div>
      <div className="emoji-picker__label">{current.label}</div>
      <div className="emoji-picker__grid">
        {current.emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            onClick={() => {
              rememberEmoji(e);
              onPick(e);
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

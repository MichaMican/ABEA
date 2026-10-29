import { memo } from "react";
import { useMediaUrl } from "../matrix/media";

const GRADIENTS = [
  ["#7b61ff", "#4f8cff"],
  ["#ff6b8b", "#ff9f5a"],
  ["#13c2a3", "#3ba7ff"],
  ["#f7b733", "#fc4a1a"],
  ["#a855f7", "#ec4899"],
  ["#22c55e", "#14b8a6"],
  ["#6366f1", "#06b6d4"],
  ["#f43f5e", "#a855f7"],
];

export function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

export function colorFor(id: string): string {
  return GRADIENTS[hashString(id) % GRADIENTS.length][0];
}

function initials(name: string): string {
  const clean = name.replace(/^[@#!+]/, "").trim();
  const words = clean.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0] ?? "";
  const second = words.length > 1 ? (Array.from(words[1])[0] ?? "") : "";
  return (first + second).toUpperCase();
}

export interface AvatarProps {
  mxc?: string | null;
  name: string;
  id: string;
  size?: number;
  online?: boolean;
  className?: string;
  onClick?: () => void;
  title?: string;
}

export const Avatar = memo(function Avatar({ mxc, name, id, size = 40, online, className, onClick, title }: AvatarProps) {
  const thumb = Math.min(512, Math.ceil(size * 2 / 32) * 32 || 96);
  const url = useMediaUrl(mxc, { width: thumb, height: thumb, method: "crop" });
  const [a, b] = GRADIENTS[hashString(id) % GRADIENTS.length];
  const style = {
    width: size,
    height: size,
    fontSize: Math.max(10, Math.round(size * 0.38)),
    backgroundImage: url ? undefined : `linear-gradient(135deg, ${a}, ${b})`,
  };
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className={`avatar ${onClick ? "avatar--clickable" : ""} ${className ?? ""}`}
      style={style}
      onClick={onClick}
      title={title ?? name}
      aria-label={name}
      type={onClick ? "button" : undefined}
    >
      {url ? <img src={url} alt="" draggable={false} /> : <span>{initials(name)}</span>}
      {online !== undefined && <i className={`avatar__status ${online ? "is-online" : ""}`} />}
    </Tag>
  );
});

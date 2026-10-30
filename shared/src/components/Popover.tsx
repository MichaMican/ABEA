import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface Anchor {
  x: number;
  y: number;
  /** Optional anchor element rect, used to place the popover above/below it. */
  rect?: DOMRect;
}

/**
 * Floating panel positioned at an anchor and clamped to the viewport.
 * When `sheet` is true it is rendered as a bottom sheet (used on phones).
 */
export function Popover({
  anchor,
  onClose,
  children,
  sheet,
  className,
  placement = "top",
}: {
  anchor: Anchor | null;
  onClose: () => void;
  children: ReactNode;
  sheet?: boolean;
  className?: string;
  placement?: "top" | "bottom";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchor || sheet || !ref.current) return;
    const el = ref.current;
    const { width, height } = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = (anchor.rect ? anchor.rect.left + anchor.rect.width / 2 : anchor.x) - width / 2;
    let top: number;
    if (anchor.rect) {
      top = placement === "top" ? anchor.rect.top - height - margin : anchor.rect.bottom + margin;
      if (top < margin) top = anchor.rect.bottom + margin;
      if (top + height > vh - margin) top = anchor.rect.top - height - margin;
    } else {
      top = anchor.y;
      if (top + height > vh - margin) top = anchor.y - height;
    }
    left = Math.max(margin, Math.min(left, vw - width - margin));
    top = Math.max(margin, Math.min(top, vh - height - margin));
    setPos({ left, top });
  }, [anchor, sheet, placement]);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    const t = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    if (!anchor) setPos(null);
  }, [anchor]);

  if (!anchor) return null;
  if (sheet) {
    return createPortal(
      <div className="sheet-backdrop">
        <div ref={ref} className={`sheet ${className ?? ""}`}>
          <div className="sheet__grip" />
          {children}
        </div>
      </div>,
      document.body,
    );
  }
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className ?? ""}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {children}
    </div>,
    document.body,
  );
}

import {
  forwardRef,
  useEffect,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { X, Search } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, icon, block, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`btn btn--${variant} btn--${size} ${block ? "btn--block" : ""} ${className ?? ""}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={16} /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: "sm" | "md" | "lg";
  variant?: "ghost" | "filled" | "primary";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, size = "md", variant = "ghost", className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`icon-btn icon-btn--${size} icon-btn--${variant} ${active ? "is-active" : ""} ${className ?? ""}`}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`spinner ${className ?? ""}`} style={{ width: size, height: size }} role="status" aria-label="Loading" />
  );
}

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: ReactNode;
  error?: string | null;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, FieldProps>(function TextField(
  { label, hint, error, leading, trailing, className, id, ...rest },
  ref,
) {
  const inputId = id ?? (label ? `f-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={`field ${error ? "field--error" : ""} ${className ?? ""}`}>
      {label && (
        <label className="field__label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="field__control">
        {leading && <span className="field__leading">{leading}</span>}
        <input ref={ref} id={inputId} className="field__input" {...rest} />
        {trailing && <span className="field__trailing">{trailing}</span>}
      </div>
      {error ? <div className="field__error">{error}</div> : hint ? <div className="field__hint">{hint}</div> : null}
    </div>
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { label?: string }>(
  function TextArea({ label, className, id, ...rest }, ref) {
    const inputId = id ?? (label ? `t-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
    return (
      <div className={`field ${className ?? ""}`}>
        {label && (
          <label className="field__label" htmlFor={inputId}>
            {label}
          </label>
        )}
        <div className="field__control">
          <textarea ref={ref} id={inputId} className="field__input field__textarea" {...rest} />
        </div>
      </div>
    );
  },
);

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="search-field">
      <Search size={17} className="search-field__icon" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
        aria-label={placeholder}
      />
      {value && (
        <button type="button" className="search-field__clear" onClick={() => onChange("")} aria-label="Clear search">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch-row ${disabled ? "is-disabled" : ""}`}>
      <span className="switch-row__text">
        <span className="switch-row__label">{label}</span>
        {description && <span className="switch-row__desc">{description}</span>}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="switch"
      />
    </label>
  );
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function Modal({ open, onClose, title, children, footer, size = "md", className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal modal--${size} ${className ?? ""}`} role="dialog" aria-modal="true">
        {title !== undefined && (
          <header className="modal__header">
            <h2>{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X size={20} />
            </IconButton>
          </header>
        )}
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`empty-state ${className ?? ""}`}>
      {icon && <div className="empty-state__icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

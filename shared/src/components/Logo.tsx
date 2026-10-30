export function Logo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="abea-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b6cff" />
          <stop offset="1" stopColor="#3f8cff" />
        </linearGradient>
        <linearGradient id="abea-logo-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#abea-logo-g)" />
      <rect width="64" height="32" rx="18" fill="url(#abea-logo-h)" />
      <path
        d="M18 20.5c0-2.5 2-4.5 4.5-4.5h19c2.5 0 4.5 2 4.5 4.5v14c0 2.5-2 4.5-4.5 4.5H31l-7.4 6.2c-.9.8-2.3.1-2.3-1.1V39h-.8c-1.4 0-2.5-1.1-2.5-2.5z"
        fill="#fff"
      />
      <circle cx="25.5" cy="27.5" r="2.6" fill="#6d5dfc" />
      <circle cx="32" cy="27.5" r="2.6" fill="#5b74fd" />
      <circle cx="38.5" cy="27.5" r="2.6" fill="#478afe" />
    </svg>
  );
}

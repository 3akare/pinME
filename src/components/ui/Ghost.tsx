/** The burn ghost: a sheet with two eyes and a ragged hem, drawn in currentColor. */
export function Ghost({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 72" aria-hidden="true" className={className} fill="currentColor">
      <path d="M32 2C16.5 2 6 13.6 6 29v39l8.7-6.5 8.6 6.5L32 61.5l8.7 6.5 8.6-6.5L58 68V29C58 13.6 47.5 2 32 2z" />
      <ellipse cx="23" cy="30" rx="4.5" ry="6.5" fill="var(--color-paper)" />
      <ellipse cx="41" cy="30" rx="4.5" ry="6.5" fill="var(--color-paper)" />
    </svg>
  );
}

/* Brand preloader: the hex-nut mark as a spinner. Honors reduced motion via
   the global animation override. */
export function Loader({
  label = "Loading",
  className = "min-h-[45vh]",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-center ${className}`} role="status" aria-label={label}>
      <svg viewBox="0 0 28 28" className="h-10 w-10 animate-spin" style={{ animationDuration: "1.1s" }} aria-hidden>
        <path
          d="M14 2.5 23.5 8v12L14 25.5 4.5 20V8L14 2.5Z"
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path
          d="M14 2.5 23.5 8v12L14 25.5 4.5 20V8L14 2.5Z"
          fill="none"
          stroke="var(--color-cta)"
          strokeWidth="3"
          strokeLinejoin="round"
          strokeDasharray="30 40"
          strokeLinecap="round"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
}

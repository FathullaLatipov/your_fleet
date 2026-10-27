/* A quiet signature detail: a semi silhouette rolls along the hero's road
   line. Pure CSS transform animation (see .drive), no JS. */
export function HeroTruck() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-16 sm:block">
      {/* road line */}
      <div className="absolute bottom-6 h-px w-full bg-white/10" />
      <div
        className="absolute bottom-6 h-px w-full opacity-25"
        style={{ background: "repeating-linear-gradient(90deg,#e8a317 0 22px,transparent 22px 60px)" }}
      />
      <div className="drive absolute bottom-[25px] left-0">
        <svg viewBox="0 0 160 46" className="h-10 w-auto" aria-hidden>
          {/* trailer */}
          <rect x="4" y="2" width="92" height="30" rx="2" fill="#39434e" opacity="0.9" />
          <rect x="4" y="2" width="92" height="6" rx="2" fill="#1f5c3c" />
          {/* cab */}
          <path d="M100 32V8h14l6 7h9l6 11v6Z" fill="#2a6b47" />
          <path d="M116 10l5 6h-10v-6Z" fill="#9fb4c4" />
          {/* marker lights */}
          <circle cx="133" cy="29" r="1.6" fill="#e8a317" />
          <circle cx="8" cy="30" r="1.4" fill="#e8a317" opacity="0.8" />
          {/* wheels */}
          {[16, 30, 104, 116, 127].map((cx) => (
            <g key={cx}>
              <circle cx={cx} cy="37" r="6.5" fill="#111417" />
              <circle cx={cx} cy="37" r="2.4" fill="#39434e" />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

/* Branded cover for shops without photos: charcoal plate, forest hazard
   stripes, category mark, shop monogram. Deterministic per shop name so the
   results page doesn't look repetitive — and clearly a cover, not a photo. */

const TINTS = ["#1f5c3c", "#174a2d", "#25543b"];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function monogram(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "YF";
}

const CATEGORY_MARK: Record<string, string> = {
  // simple path icons drawn for 24x24
  truck_trailer:
    "M2 16V7h11v9M13 10h5l3 3v3h-3M2 16h2m3.5 0H13m4.5 0H21M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  tire: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-11v3m6.4 1.6-2.2 2.2M18.4 17.6l-2.2-2.2M12 20v-3m-6.4-1.4 2.2-2.2M5.6 6.4l2.2 2.2",
  towing: "M3 17h13l5-5v5M8 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm11 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM7 12l3-6 4 6M10 6v6",
  mobile_mechanic:
    "M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z",
  pickup_auto:
    "M3 15v-3l2-5h10l2 5h4v3h-2M3 15h2m4 0h6m4 0h2M7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  other:
    "M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z",
};

export function ShopCover({
  name,
  category,
  locality,
  className = "",
  showLabel = false,
}: {
  name: string;
  category: string;
  locality?: string | null;
  className?: string;
  showLabel?: boolean;
}) {
  const tint = TINTS[hashCode(name) % TINTS.length];
  const mark = CATEGORY_MARK[category] ?? CATEGORY_MARK.other;
  return (
    <div
      aria-hidden
      className={`relative grid place-items-center overflow-hidden bg-charcoal ${className}`}
    >
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 160 100">
        <rect width="160" height="100" fill="#16181b" />
        <g opacity="0.5">
          <path d="M-20 100 40 0h14L-6 100Z" fill={tint} />
          <path d="M20 100 80 0h7L27 100Z" fill={tint} opacity="0.6" />
          <path d="M120 100 180 0h14l-60 100Z" fill={tint} opacity="0.8" />
        </g>
      </svg>
      <div className="relative flex flex-col items-center gap-1 text-white/85">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <path d={mark} />
        </svg>
        <span className="display text-sm font-bold tracking-widest">{monogram(name)}</span>
        {locality && showLabel && (
          <span className="display text-xs font-semibold tracking-wide text-white/70">{locality}</span>
        )}
        {showLabel && <span className="text-[11px] text-white/50">No photos yet</span>}
      </div>
    </div>
  );
}

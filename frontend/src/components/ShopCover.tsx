/* Illustrated cover for shops without photos: a category scene (semi, tires,
   wrecker, service van...) on a dusk-road backdrop. Deterministic per shop
   name — tint, composition and mirroring vary, so lists feel alive — and
   clearly artwork, never passed off as a photo of the business. */

const TINTS = ["#1f5c3c", "#2a6b47", "#17452b"];

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function monogram(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? "") + (words[1]?.[0] ?? "")).toUpperCase() || "YF";
}

const BODY = "#39434e";
const BODY_DARK = "#242c34";
const TIRE = "#111417";
const GLASS = "#9fb4c4";

/* Each scene draws into a 160x100 viewBox; ground line is at y=78. */
function SemiScene({ tint }: { tint: string }) {
  return (
    <g>
      {/* trailer */}
      <rect x="12" y="30" width="80" height="36" rx="2" fill={BODY} />
      <rect x="12" y="30" width="80" height="7" rx="2" fill={tint} />
      <rect x="12" y="62" width="80" height="4" fill={BODY_DARK} />
      {/* cab */}
      <path d="M96 66V38h12l5 6h8l5 12v10Z" fill={tint} />
      <path d="M109 44l4 5h-9v-5Z" fill={GLASS} />
      <rect x="97.5" y="26" width="3.5" height="12" rx="1" fill={BODY_DARK} />
      <rect x="94" y="62" width="34" height="4" fill={BODY_DARK} />
      {/* wheels */}
      {[24, 38, 98, 110, 121].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="70" r="7.5" fill={TIRE} />
          <circle cx={cx} cy="70" r="3" fill={BODY} />
        </g>
      ))}
    </g>
  );
}

function TireScene({ tint }: { tint: string }) {
  return (
    <g>
      <circle cx="96" cy="52" r="26" fill={TIRE} />
      <circle cx="96" cy="52" r="16" fill={BODY} />
      <circle cx="96" cy="52" r="7" fill={tint} />
      {Array.from({ length: 8 }).map((_, i) => {
        const a = (i * Math.PI) / 4;
        return (
          <rect
            key={i}
            x="94.5"
            y="24"
            width="3"
            height="8"
            fill={BODY_DARK}
            transform={`rotate(${(a * 180) / Math.PI} 96 52)`}
          />
        );
      })}
      {/* stacked tires */}
      <ellipse cx="46" cy="72" rx="16" ry="6" fill={TIRE} />
      <ellipse cx="46" cy="64" rx="16" ry="6" fill={BODY_DARK} />
      <ellipse cx="46" cy="56" rx="16" ry="6" fill={TIRE} />
      <ellipse cx="46" cy="52" rx="8" ry="2.5" fill={tint} />
    </g>
  );
}

function TowScene({ tint }: { tint: string }) {
  return (
    <g>
      {/* flat bed + boom */}
      <rect x="16" y="58" width="58" height="8" fill={BODY} />
      <path d="M22 58 66 34l3 4-44 24Z" fill={BODY_DARK} />
      <path d="M66 34v12" stroke={BODY_DARK} strokeWidth="2.5" />
      <path d="M62 46h8l-4 7Z" fill={tint} />
      {/* cab */}
      <path d="M74 66V42h14l6 7h7l4 9v8Z" fill={tint} />
      <path d="M89 47l4 5h-9v-5Z" fill={GLASS} />
      <rect x="72" y="62" width="34" height="4" fill={BODY_DARK} />
      {[28, 44, 80, 96].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="70" r="7.5" fill={TIRE} />
          <circle cx={cx} cy="70" r="3" fill={BODY} />
        </g>
      ))}
      <circle cx="120" cy="40" r="5" fill="none" stroke={tint} strokeWidth="2.5" />
    </g>
  );
}

function VanScene({ tint }: { tint: string }) {
  return (
    <g>
      <path d="M34 66V40a4 4 0 0 1 4-4h52l12 12v18Z" fill={tint} />
      <path d="M88 40l8 8H78v-8Z" fill={GLASS} />
      <rect x="34" y="58" width="68" height="4" fill={BODY_DARK} />
      <rect x="40" y="44" width="26" height="10" rx="1.5" fill={BODY} />
      {/* wrench emblem */}
      <path
        d="M118 32a7 7 0 0 1 8.7-6.8l-4.9 4.9 3.5 3.5 4.9-4.9A7 7 0 0 1 121 38l-9 9-3.7-3.7 9-9c.2-.8.4-1.5.7-2.3Z"
        fill={BODY}
      />
      {[46, 88].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="68" r="7.5" fill={TIRE} />
          <circle cx={cx} cy="68" r="3" fill={BODY} />
        </g>
      ))}
    </g>
  );
}

function PickupScene({ tint }: { tint: string }) {
  return (
    <g>
      <path d="M36 66V52h30v-9a3 3 0 0 1 3-3h16l9 12h14l4 6v8Z" fill={tint} />
      <path d="M72 44h11l6 8H72Z" fill={GLASS} />
      <rect x="36" y="52" width="30" height="3" fill={BODY_DARK} />
      <rect x="36" y="62" width="76" height="4" fill={BODY_DARK} />
      {[48, 96].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="68" r="7.5" fill={TIRE} />
          <circle cx={cx} cy="68" r="3" fill={BODY} />
        </g>
      ))}
    </g>
  );
}

const SCENES: Record<string, (p: { tint: string }) => React.ReactNode> = {
  truck_trailer: SemiScene,
  tire: TireScene,
  towing: TowScene,
  mobile_mechanic: VanScene,
  pickup_auto: PickupScene,
  other: SemiScene,
};

export function ShopCover({
  name,
  category,
  locality,
  className = "",
  showLabel = false,
  showMonogram = true,
}: {
  name: string;
  category: string;
  locality?: string | null;
  className?: string;
  showLabel?: boolean;
  showMonogram?: boolean;
}) {
  const h = hashCode(name);
  const tint = TINTS[h % TINTS.length];
  const flip = h % 2 === 1;
  const sunPos = 12 + (h % 5) * 18; // percent from the left
  const Scene = SCENES[category] ?? SCENES.other;
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden ${className}`}
      style={{ background: `linear-gradient(150deg, #171b1d 0%, ${tint}33 70%, #14181a 100%)` }}
    >
      {/* amber dusk glow — CSS so it scales to any aspect ratio */}
      <div
        className="absolute h-[55%] aspect-square rounded-full opacity-60"
        style={{
          left: `${sunPos}%`, top: "-12%",
          background: "radial-gradient(circle, #e8a31799 0%, #e8a31722 45%, transparent 70%)",
        }}
      />
      {/* road bed + center line */}
      <div className="absolute inset-x-0 bottom-0 h-[24%] bg-[#1c2125]" />
      <div
        className="absolute inset-x-0 bottom-[10%] h-[3px] opacity-50"
        style={{ background: "repeating-linear-gradient(90deg, #e8a317 0 26px, transparent 26px 50px)" }}
      />
      {/* vehicle scene keeps its own aspect ratio, centered */}
      <svg
        className="absolute bottom-0 left-1/2 h-full -translate-x-1/2"
        style={{ aspectRatio: "160 / 100" }}
        preserveAspectRatio="xMidYMax meet"
        viewBox="0 0 160 100"
      >
        <g transform={flip ? "translate(160 0) scale(-1 1)" : undefined}>
          <Scene tint={tint} />
        </g>
      </svg>
      {showMonogram && (
        <div className="absolute left-2.5 top-2.5 rounded bg-charcoal/70 px-2 py-0.5">
          <span className="display text-xs font-bold tracking-widest text-white/90">
            {monogram(name)}
          </span>
        </div>
      )}
      {showLabel && (
        <div className="absolute bottom-2 right-2.5 text-right">
          {locality && (
            <p className="display text-xs font-semibold tracking-wide text-white/80">{locality}</p>
          )}
          <p className="text-[10px] text-white/50">Illustration — no photos yet</p>
        </div>
      )}
    </div>
  );
}

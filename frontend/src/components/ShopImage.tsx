"use client";

import { ShopCover } from "@/components/ShopCover";
import { mediaUrl } from "@/lib/types";
import stockManifest from "../../public/stock/manifest.json";

const STOCK = stockManifest as Record<string, string[]>;

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/* Shop imagery priority: owner-uploaded photo -> bundled licensed stock photo
   for the category (deterministic per shop, clearly illustrative) -> branded
   illustration. No external image APIs. */
export function ShopImage({
  name,
  category,
  photoPath,
  className = "",
  locality,
  showLabel = false,
  attribution = false,
}: {
  businessId?: string;
  name: string;
  category: string;
  photoPath?: string | null;
  hasGooglePhoto?: boolean;
  width?: number;
  className?: string;
  locality?: string | null;
  showLabel?: boolean;
  attribution?: boolean;
}) {
  if (photoPath) {
    return (
      <div className={`relative overflow-hidden ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={mediaUrl(photoPath)} alt={`${name} photo`} loading="lazy"
             className="absolute inset-0 h-full w-full object-cover" />
      </div>
    );
  }

  const pool = STOCK[category] ?? STOCK.other ?? [];
  if (pool.length === 0) {
    return (
      <ShopCover name={name} category={category} locality={locality}
                 showLabel={showLabel} className={className} />
    );
  }
  const file = pool[hashCode(name) % pool.length];
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/stock/${file}`} alt="" loading="lazy"
           className="absolute inset-0 h-full w-full object-cover" />
      {attribution && (
        <span className="absolute bottom-1.5 right-2 rounded bg-charcoal/60 px-1.5 py-0.5 text-[10px] text-white/75">
          Illustrative photo
        </span>
      )}
    </div>
  );
}

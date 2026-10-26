"use client";

import { useState } from "react";

import { ShopCover } from "@/components/ShopCover";
import { mediaUrl } from "@/lib/types";

/* Shop imagery priority: owner-uploaded photo -> live Google Places photo
   (served by Google at request time, never stored) -> branded illustration. */
export function ShopImage({
  businessId,
  name,
  category,
  photoPath,
  hasGooglePhoto,
  width = 480,
  className = "",
  locality,
  showLabel = false,
  attribution = false,
}: {
  businessId: string;
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
  const [failed, setFailed] = useState(false);

  const src = photoPath
    ? mediaUrl(photoPath)
    : hasGooglePhoto && !failed
      ? mediaUrl(`/api/businesses/${businessId}/google-photo?w=${width}`)
      : null;

  if (!src) {
    return (
      <ShopCover name={name} category={category} locality={locality}
                 showLabel={showLabel} className={className} />
    );
  }
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`${name} photo`} loading="lazy"
           className="absolute inset-0 h-full w-full object-cover"
           onError={() => setFailed(true)} />
      {attribution && !photoPath && (
        <span className="absolute bottom-1.5 right-2 rounded bg-charcoal/60 px-1.5 py-0.5 text-[10px] text-white/75">
          Photo: Google
        </span>
      )}
    </div>
  );
}

import type { BusinessListItem } from "@/lib/types";

/* Trust levels are distinct, never interchangeable:
   imported (no badge) -> claimed -> verified -> partner -> partner offer. */

export function TrustBadges({
  b,
  compact = false,
}: {
  b: Pick<BusinessListItem, "is_claimed" | "is_verified" | "partner_status" | "has_active_offer">;
  compact?: boolean;
}) {
  const badges: React.ReactNode[] = [];
  if (b.partner_status === "active" && b.has_active_offer) {
    badges.push(
      <span key="offer" className="rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink border border-amber/50">
        Partner offer
      </span>,
    );
  } else if (b.partner_status === "active") {
    badges.push(
      <span key="partner" className="rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink">
        Partner
      </span>,
    );
  }
  if (b.is_verified) {
    badges.push(
      <span key="verified" className="rounded bg-pine-wash px-1.5 py-0.5 text-xs font-semibold text-pine">
        Verified
      </span>,
    );
  } else if (b.is_claimed) {
    badges.push(
      <span key="claimed" className="rounded bg-mist px-1.5 py-0.5 text-xs font-medium text-steel">
        Claimed
      </span>,
    );
  } else if (!compact) {
    badges.push(
      <span key="listing" className="rounded bg-mist px-1.5 py-0.5 text-xs text-faint">
        Directory listing
      </span>,
    );
  }
  return <span className="inline-flex flex-wrap items-center gap-1.5">{badges}</span>;
}

export function Stars({ avg, count }: { avg: number | null; count: number }) {
  if (avg == null || count === 0) {
    return <span className="text-sm text-faint">No reviews yet</span>;
  }
  return (
    <span className="text-sm text-ink" aria-label={`Rated ${avg} out of 5 from ${count} reviews`}>
      <span className="text-amber-ink font-semibold">{avg.toFixed(1)}★</span>{" "}
      <span className="text-faint">({count})</span>
    </span>
  );
}

/** Third-party rating, always attributed. Rendered only when real data exists. */
export function GoogleRating({ rating, count }: { rating: number | null; count: number | null }) {
  if (rating == null) return null;
  return (
    <span
      className="text-sm text-steel"
      aria-label={`Rated ${rating} out of 5 on Google${count ? ` from ${count} reviews` : ""}`}
    >
      <span className="font-semibold text-amber-ink">{rating.toFixed(1)}★</span>{" "}
      on Google{count != null && <span className="text-faint"> ({count.toLocaleString()})</span>}
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  requested: "bg-mist text-steel",
  quoted: "bg-amber-wash text-amber-ink",
  accepted: "bg-pine-wash text-pine",
  confirmed: "bg-pine-wash text-pine",
  in_progress: "bg-pine-wash text-pine",
  completed: "bg-pine text-white",
  cancelled: "bg-mist text-faint",
  disputed: "bg-danger-wash text-danger",
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? "bg-mist text-steel"}`}>
      {status.replace("_", " ")}
    </span>
  );
}

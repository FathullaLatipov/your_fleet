"use client";

import { useEffect, useRef, useState } from "react";

import { rcCall, rcPhoneEnabled, setRcPhoneEnabled } from "@/lib/ringcentral";

function PhoneIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.3.2 2.5.57 3.6a1 1 0 0 1-.24 1l-2.2 2.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Click-to-call through the RingCentral phone. If the viewer hasn't enabled the
 * phone yet, the first tap offers to turn it on (and still places the call).
 * Renders nothing when there's no number to dial.
 */
export function CallButton({
  phone,
  label = "Call",
  className,
  compact = false,
}: {
  phone?: string | null;
  label?: string;
  className?: string;
  compact?: boolean;
}) {
  const [ask, setAsk] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!ask) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setAsk(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [ask]);

  if (!phone || !phone.trim()) return null;

  const place = () => {
    setAsk(false);
    rcCall(phone);
  };
  const onClick = () => {
    if (rcPhoneEnabled()) place();
    else setAsk(true);
  };
  const enableAndCall = () => {
    setRcPhoneEnabled(true);
    place();
  };

  const base = compact
    ? "inline-flex items-center gap-1.5 rounded-full bg-pine-wash px-2.5 py-1 text-xs font-semibold text-pine hover:bg-pine/15"
    : "btn-forest inline-flex items-center justify-center gap-1.5 !py-2.5";

  return (
    <span ref={wrap} className="relative inline-flex">
      <button type="button" onClick={onClick} className={className ?? base}>
        <PhoneIcon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        {label}
      </button>
      {ask && (
        <span className="absolute left-0 top-full z-30 mt-1.5 w-64 rounded-xl border border-line bg-white p-3 text-left shadow-xl">
          <span className="block text-sm font-semibold text-ink">Turn on RingCentral calling?</span>
          <span className="mt-1 block text-xs text-steel">
            Calls run through a RingCentral phone in the corner of the screen. Sign in with your
            RingCentral account once — then every Call button works.
          </span>
          <span className="mt-2.5 flex items-center gap-2">
            <button type="button" onClick={enableAndCall} className="btn-forest !py-1.5 text-xs">
              Enable &amp; call
            </button>
            <a href={`tel:${phone}`} className="text-xs font-semibold text-steel hover:text-ink">
              Use my phone
            </a>
          </span>
        </span>
      )}
    </span>
  );
}

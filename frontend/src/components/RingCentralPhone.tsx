"use client";

import { useEffect } from "react";

import { RC_CHANGE_EVENT, ensureRcWidget, rcPhoneEnabled } from "@/lib/ringcentral";

/**
 * Mounts the RingCentral Embeddable phone app-wide, but only once the viewer
 * has turned it on (Profile → Integrations, or the first Call button tap).
 * Renders nothing itself — the widget injects its own floating phone.
 */
export function RingCentralPhone() {
  useEffect(() => {
    const sync = () => {
      if (rcPhoneEnabled()) ensureRcWidget();
    };
    sync();
    window.addEventListener(RC_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync); // another tab toggled it
    return () => {
      window.removeEventListener(RC_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return null;
}

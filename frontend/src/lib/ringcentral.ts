// RingCentral Embeddable click-to-call. The phone is a ready-made widget that
// RingCentral hosts; it carries its own softphone (WebRTC), dialer and call
// log, and signs each user into THEIR own RingCentral account. We never store
// a token for it — we only load the widget and ask it to place calls.
//
// It is loaded lazily: nothing is fetched until the user turns the phone on in
// Profile → Integrations (or taps a Call button), so visitors who don't use it
// never pull a third-party script.

const ENABLED_KEY = "yf_rc_phone";
const ADAPTER_ID = "rc-embeddable-adapter";
export const RC_CHANGE_EVENT = "yf-rc-change";

export function rcClientId(): string {
  return process.env.NEXT_PUBLIC_RINGCENTRAL_CLIENT_ID ?? "";
}

export function rcPhoneEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "1";
  } catch {
    return false;
  }
}

export function setRcPhoneEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(ENABLED_KEY, "1");
    else localStorage.removeItem(ENABLED_KEY);
  } catch {
    /* storage unavailable — the widget just won't persist across reloads */
  }
  try {
    window.dispatchEvent(new Event(RC_CHANGE_EVENT));
  } catch {
    /* no window (SSR) */
  }
}

// Keep a leading + and digits only — what RingCentral expects for dialing.
export function normalizePhone(raw: string): string {
  const s = (raw || "").trim();
  const plus = s.startsWith("+") ? "+" : "";
  return plus + s.replace(/\D/g, "");
}

function adapterSrc(): string {
  const base =
    "https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js";
  const p = new URLSearchParams({
    defaultCallWith: "browser", // place calls through the in-browser softphone
    appServer: "https://platform.ringcentral.com",
  });
  const cid = rcClientId();
  if (cid) p.set("clientId", cid); // our own app; omitted → RingCentral demo app
  return `${base}?${p.toString()}`;
}

// Inject the Embeddable adapter once; it appends its own floating phone iframe.
export function ensureRcWidget(): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(ADAPTER_ID)) return;
  const s = document.createElement("script");
  s.id = ADAPTER_ID;
  s.src = adapterSrc();
  s.async = true;
  (document.body || document.documentElement).appendChild(s);
}

interface RCAdapterWindow extends Window {
  RCAdapter?: { clickToCall?: (num: string, start?: boolean) => void };
}

// Place a click-to-call. Loads the widget if needed, then dials once it's
// ready (the adapter can take a moment to boot). Returns false only when there
// is no number to dial.
export function rcCall(rawNumber: string): boolean {
  const number = normalizePhone(rawNumber);
  if (!number) return false;
  ensureRcWidget();

  let tries = 0;
  const attempt = () => {
    const w = window as RCAdapterWindow;
    if (w.RCAdapter?.clickToCall) {
      w.RCAdapter.clickToCall(number, true);
      return;
    }
    const frame = document.querySelector<HTMLIFrameElement>(
      "#rc-widget-adapter-frame",
    );
    if (frame?.contentWindow) {
      frame.contentWindow.postMessage(
        { type: "rc-adapter-new-call", phoneNumber: number, toCall: true },
        "*",
      );
      return;
    }
    if (tries++ < 40) setTimeout(attempt, 250); // wait up to ~10s for boot
  };
  attempt();
  return true;
}

export type Hours = Record<string, [string, string][]>;

export interface OpenStatus {
  kind: "open" | "closed" | "unknown";
  label: string;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m ? `${h12}:${String(m).padStart(2, "0")} ${ampm}` : `${h12} ${ampm}`;
}

/** Open/closed from the shop's verified hours, evaluated in the viewer's local
 * time (close enough for nearby searches; a per-shop timezone is future work).
 * Unknown hours are NEVER shown as open. */
export function openStatus(hours: Hours | null | undefined, now = new Date()): OpenStatus {
  if (!hours) return { kind: "unknown", label: "Hours not verified" };
  const day = DAY_KEYS[now.getDay()];
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const ranges = hours[day] ?? [];
  for (const [open, close] of ranges) {
    if (open <= hhmm && hhmm < close) {
      return { kind: "open", label: `Open now · closes ${fmt12(close)}` };
    }
  }
  const next = ranges.find(([open]) => open > hhmm);
  if (next) return { kind: "closed", label: `Closed · opens ${fmt12(next[0])}` };
  return { kind: "closed", label: "Closed today" };
}

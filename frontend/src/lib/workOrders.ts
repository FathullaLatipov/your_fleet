/* Contract for /api/fleet/work-orders. */

export interface WoQuote {
  id: string;
  business_id: string | null;
  shop_name: string;
  price_cents: number | null;
  eta: string | null;
  note: string | null;
  status: "pending" | "accepted" | "declined";
  created_at: string;
}

export interface WoEvent {
  id: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

export interface WoAttachment {
  id: string;
  kind: "photo" | "invoice" | "payment_proof";
  original_name: string | null;
  content_type: string | null;
  created_at: string;
}

export interface WorkOrder {
  id: string;
  wo_number: number;
  status: WoStatus;
  service_type: string;
  priority: string;
  call_type: string | null;
  description: string;
  vehicle_id: string | null;
  trailer_id: string | null;
  driver_id: string | null;
  driver_name: string | null;
  business_id: string | null;
  shop_name: string | null;
  shop_confirmed_at: string | null;
  final_amount_cents: number | null;
  discount_cents: number | null;
  payment_method: string | null;
  closing_notes: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  quote_count: number;
  accepted_quote_id: string | null;
  unit_number: string | null;
  trailer_unit: string | null;
  quotes?: WoQuote[];
  events?: WoEvent[];
  attachments?: WoAttachment[];
}

export type WoStatus =
  | "open"
  | "looking_for_shop"
  | "quote_received"
  | "approved"
  | "in_progress"
  | "ready"
  | "closed";

export const WO_STATUS_ORDER: WoStatus[] = [
  "open", "looking_for_shop", "quote_received", "approved",
  "in_progress", "ready", "closed",
];

export const WO_STATUS_LABELS: Record<WoStatus, string> = {
  open: "Open",
  looking_for_shop: "Looking for Shop",
  quote_received: "Quote Received",
  approved: "Approved",
  in_progress: "In Progress",
  ready: "Ready",
  closed: "Closed",
};

export const WO_SERVICE_LABELS: Record<string, string> = {
  repair: "Repair",
  preventive: "Preventive",
  inspection: "Inspection",
  other: "Other",
};

export const WO_PRIORITY_LABELS: Record<string, string> = {
  normal: "Normal",
  urgent: "Urgent",
  roadside: "Roadside",
};

export const WO_PAY_LABELS: Record<string, string> = {
  driver_paid: "Paid by Driver",
  efs: "EFS",
  comchek: "Comchek",
  zelle: "Zelle",
  ach: "ACH",
};

/* Status pill styling on the shared palette. */
export function statusPill(s: WoStatus): string {
  if (s === "closed") return "bg-charcoal text-white";
  if (s === "quote_received") return "bg-amber-wash text-amber-ink";
  if (s === "in_progress" || s === "ready" || s === "approved")
    return "bg-pine-wash text-pine";
  return "bg-mist text-steel";
}

export function unitLabel(wo: WorkOrder): string {
  const parts: string[] = [];
  if (wo.unit_number) parts.push(`Truck #${wo.unit_number}`);
  if (wo.trailer_unit) parts.push(`Trailer #${wo.trailer_unit}`);
  return parts.join(" + ") || "—";
}

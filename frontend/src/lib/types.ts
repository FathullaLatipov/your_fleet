export type Role = "driver" | "provider" | "fleet_manager" | "admin";

export interface User {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
}

export interface BusinessListItem {
  id: string;
  name: string;
  category: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  lat: number;
  lng: number;
  rating_avg: number | null;
  rating_count: number;
  partner_status: "none" | "active" | "suspended";
  is_claimed: boolean;
  is_verified: boolean;
  has_active_offer: boolean;
  distance_miles: number | null;
}

export interface Offer {
  id: string;
  title: string;
  offer_type: "fixed_amount" | "percentage" | "negotiated_rate" | "quote_based";
  standard_price_cents: number | null;
  marketplace_price_cents: number | null;
  discount_percent: number | null;
  conditions: string | null;
  min_charge_cents: number | null;
  exclusions: string | null;
  starts_at: string | null;
  expires_at: string | null;
  savings_cents: number | null;
  status?: string;
  business_id?: string;
  created_at?: string;
}

export interface BusinessService {
  id: string;
  service: { id: string; slug: string; name: string };
  standard_price_cents: number | null;
  price_note: string | null;
}

export interface BusinessDetail {
  id: string;
  name: string;
  category: string;
  address_raw: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  website: string | null;
  lat: number;
  lng: number;
  description: string | null;
  hours: Record<string, [string, string][]> | null;
  is_mobile_service: boolean | null;
  accepts_emergency: boolean | null;
  partner_status: "none" | "active" | "suspended";
  rating_avg: number | null;
  rating_count: number;
  is_claimed: boolean;
  is_verified: boolean;
  services: BusinessService[];
  offers: Offer[];
}

export type BookingStatus =
  | "requested" | "quoted" | "accepted" | "confirmed"
  | "in_progress" | "completed" | "cancelled" | "disputed";

export interface Booking {
  id: string;
  business_id: string;
  driver_id: string;
  offer_id: string | null;
  status: BookingStatus;
  urgency: "scheduled" | "emergency";
  issue_description: string;
  truck_info: Record<string, string> | null;
  location_text: string | null;
  preferred_time: string | null;
  quoted_price_cents: number | null;
  quote_note: string | null;
  final_price_cents: number | null;
  commission_amount_cents: number | null;
  provider_payout_cents: number | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: string;
  business_id: string;
  rating: number;
  text: string | null;
  status: string;
  created_at: string;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, string> | null;
  read_at: string | null;
  created_at: string;
}

export interface Claim {
  id: string;
  business_id: string;
  user_id: string;
  status: "pending" | "approved" | "rejected";
  evidence: string | null;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export interface SearchResponse {
  total: number;
  items: BusinessListItem[];
  resolved_location: { lat: number; lng: number } | null;
}

export const fmtUsd = (cents: number | null | undefined): string =>
  cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

export const CATEGORY_LABELS: Record<string, string> = {
  truck_trailer: "Truck & trailer",
  pickup_auto: "Pickup & auto",
  tire: "Tire service",
  towing: "Towing",
  mobile_mechanic: "Mobile mechanic",
  other: "Other",
};

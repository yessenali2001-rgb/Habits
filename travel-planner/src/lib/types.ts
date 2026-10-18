// Row shapes returned by the database (hand-written to keep the project dependency-light; they can be
// replaced by `supabase gen types typescript` output if you prefer generated types).

export type TripRole = 'owner' | 'editor' | 'viewer';
export type RsvpStatus = 'invited' | 'going' | 'maybe' | 'declined';
export type ItemKind =
  | 'activity' | 'sightseeing' | 'restaurant' | 'meeting' | 'event' | 'transport' | 'lodging' | 'other';
export type ExpenseCategory = 'accommodation' | 'transport' | 'food' | 'tickets' | 'shopping' | 'other';
export type ExpenseKind = 'estimated' | 'confirmed';
export type SplitMode = 'equal' | 'custom' | 'none';
export type TravelStyle = 'relaxed' | 'adventure' | 'culture' | 'foodie' | 'family' | 'business' | 'budget' | 'luxury';

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  timezone: string;
  email_notifications: boolean;
  reminder_minutes: number;
}

export interface Trip {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  cover_path: string | null;
  start_date: string;
  end_date: string;
  timezone: string;
  currency: string;
  budget_total: number | null;
  travel_style: TravelStyle | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Participant {
  trip_id: string;
  user_id: string;
  role: TripRole;
  status: RsvpStatus;
  joined_at: string;
}

export interface Destination {
  id: string;
  trip_id: string;
  name: string;
  country: string | null;
  lat: number | null;
  lng: number | null;
  timezone: string;
  arrive_date: string | null;
  depart_date: string | null;
  position: number;
}

export interface ItemLink { label: string; url: string }

export interface ItineraryItem {
  id: string;
  trip_id: string;
  destination_id: string | null;
  kind: ItemKind;
  title: string;
  notes: string | null;
  location_name: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  /** Local wall-clock time at the place, `YYYY-MM-DDTHH:mm:ss` (no zone). */
  start_local: string;
  end_local: string | null;
  all_day: boolean;
  timezone: string;
  end_timezone: string | null;
  /** UTC instants derived by the database. */
  starts_at: string;
  ends_at: string | null;
  day_date: string;
  sort_order: number;
  cost_estimate: number | null;
  cost_currency: string | null;
  links: ItemLink[];
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  trip_id: string;
  item_id: string | null;
  user_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

export interface TripTask {
  id: string;
  trip_id: string;
  kind: 'task' | 'packing' | 'prep';
  title: string;
  assignee_id: string | null;
  due_date: string | null;
  done: boolean;
}

export interface Expense {
  id: string;
  trip_id: string;
  item_id: string | null;
  title: string;
  category: ExpenseCategory;
  kind: ExpenseKind;
  amount: number;
  currency: string;
  paid_by: string | null;
  expense_date: string | null;
  split_mode: SplitMode;
  notes: string | null;
}

export interface ExpenseShare { expense_id: string; trip_id: string; user_id: string; amount: number }
export interface FxRate { trip_id: string; currency: string; rate_to_base: number }

export interface NotificationRow {
  id: string;
  user_id: string;
  trip_id: string | null;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface ActivityRow {
  id: number;
  trip_id: string;
  actor_id: string | null;
  action: 'create' | 'update' | 'delete';
  entity: string;
  entity_id: string | null;
  summary: string;
  changes: Record<string, { from: string | null; to: string | null }> | null;
  created_at: string;
}

export interface InviteRow {
  id: string;
  trip_id: string;
  email: string | null;
  role: TripRole;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  revoked_at: string | null;
}

export const ITEM_KINDS: { value: ItemKind; label: string; emoji: string }[] = [
  { value: 'activity', label: 'Activity', emoji: '🎯' },
  { value: 'sightseeing', label: 'Sightseeing', emoji: '🏛️' },
  { value: 'restaurant', label: 'Restaurant', emoji: '🍝' },
  { value: 'meeting', label: 'Meeting', emoji: '🤝' },
  { value: 'event', label: 'Event', emoji: '🎟️' },
  { value: 'transport', label: 'Transport', emoji: '🚆' },
  { value: 'lodging', label: 'Hotel / lodging', emoji: '🛏️' },
  { value: 'other', label: 'Other', emoji: '📌' },
];

export const EXPENSE_CATEGORIES: { value: ExpenseCategory; label: string; emoji: string }[] = [
  { value: 'accommodation', label: 'Accommodation', emoji: '🛏️' },
  { value: 'transport', label: 'Transport', emoji: '🚆' },
  { value: 'food', label: 'Food & drink', emoji: '🍝' },
  { value: 'tickets', label: 'Tickets & tours', emoji: '🎟️' },
  { value: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { value: 'other', label: 'Other', emoji: '📌' },
];

export const TRAVEL_STYLES: { value: TravelStyle; label: string }[] = [
  { value: 'relaxed', label: 'Relaxed' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'culture', label: 'Culture & history' },
  { value: 'foodie', label: 'Food-focused' },
  { value: 'family', label: 'Family' },
  { value: 'business', label: 'Business' },
  { value: 'budget', label: 'Budget' },
  { value: 'luxury', label: 'Luxury' },
];

export const kindMeta = (k: ItemKind) => ITEM_KINDS.find((x) => x.value === k) ?? ITEM_KINDS[ITEM_KINDS.length - 1];
export const canEditRole = (r: TripRole | null | undefined) => r === 'owner' || r === 'editor';

/**
 * The shared vocabulary of the back office — types and the state machine.
 *
 * DELIBERATELY NOT `server-only`. Client components need the status list to
 * render a filter, and the transition map to decide which buttons exist; if
 * those lived in queries.ts or mutations.ts, importing them would pull the
 * database client into the browser bundle. Turbopack says so plainly, and it
 * is right to.
 *
 * Nothing here touches the database or reads an environment variable. It is
 * facts about the domain, safe on both sides of the wire.
 */

import type { ServiceArea } from "@/lib/booking/serviceArea";

export type BookingStatus =
  | "holding"
  | "pending"
  | "confirmed"
  | "assigned"
  | "en_route"
  | "completed"
  | "cancelled"
  | "expired";

/** The statuses the back office works with. Holds and expiry are transient. */
export const OPERATIONAL_STATUSES: BookingStatus[] = [
  "confirmed",
  "assigned",
  "en_route",
  "completed",
  "cancelled",
];

/**
 * The legal state machine, mirrored from `transition_booking_status` in
 * drizzle/0001_booking_locking.sql.
 *
 * Duplicated here ONLY so the UI can offer the right buttons. The database is
 * the authority: it raises `illegal_transition` regardless of what this map
 * says, which is what makes a hand-crafted request fail too.
 * `tests/admin-transitions.test.ts` checks all 64 combinations against the
 * real function, so drift is a test failure rather than a support ticket.
 */
export const ALLOWED_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  holding: ["pending", "cancelled", "expired"],
  pending: ["confirmed", "cancelled", "expired"],
  confirmed: ["assigned", "cancelled"],
  assigned: ["en_route", "confirmed", "cancelled"],
  en_route: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  expired: [],
};

/**
 * What the back office offers.
 *
 * A subset of the above: holds expire on their own and `pending` is the
 * momentary state between payment starting and the webhook arriving. Offering
 * an admin a button to move a booking to `expired` invites them to race the
 * sweeper.
 */
export const ADMIN_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  holding: ["cancelled"],
  pending: ["cancelled"],
  confirmed: ["assigned", "cancelled"],
  assigned: ["en_route", "cancelled"],
  en_route: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  expired: [],
};

export type BookingSummary = {
  id: string;
  reference: string;
  bookingDate: string;
  preferredStart: string;
  status: BookingStatus;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  area: string | null;
  city: string | null;
  priceTotal: number;
  currency: string;
  driverId: string | null;
  driverName: string | null;
  createdAt: string;
};

export type CalendarDay = {
  date: string;
  bookings: BookingSummary[];
  blackout: { id: string; reason: string | null } | null;
};

export type OrdersResult = {
  rows: BookingSummary[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

/**
 * A dispatch recipient.
 *
 * Still called DriverRow where it is the person DRIVING — `bookings.assigned_driver`
 * still means that — but since phase 9 the underlying table is
 * `dispatch_recipients` and a row may equally be an owner, a supervisor or the
 * technician. `role` says which.
 */
export type DriverRow = {
  id: string;
  fullName: string;
  phone: string;
  role: "driver" | "owner" | "supervisor" | "other";
  /** Dispatched automatically on every newly confirmed booking. */
  isDefault: boolean;
  isActive: boolean;
  /** Open jobs, so a dispatcher can see who is already busy. */
  activeJobs: number;
  /**
   * Every booking ever assigned to them. A driver with history can only be
   * DEACTIVATED — deleting them would `SET NULL` on those bookings and erase
   * who actually ran the job.
   */
  totalJobs: number;
};

export type BookingNoteRow = {
  id: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type AdminSettings = {
  priceRental: number;
  priceSetup: number;
  priceDelivery: number;
  currency: string;
  availableStartTimes: string[];
  leadTimeHours: number;
  maxAdvanceDays: number;
  holdMinutes: number;
  adminNotificationEmails: string[];
  /** Bilingual since 0012; the English name is the canonical value. */
  serviceAreas: ServiceArea[];
  updatedAt: string;
};

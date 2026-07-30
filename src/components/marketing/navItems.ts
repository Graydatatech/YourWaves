/**
 * Single source of truth for the in-page navigation, shared by the desktop bar,
 * the mobile sheet and the footer so they can never drift apart.
 *
 * `key` indexes into the `nav` message namespace; `hash` is the section id.
 */
export const NAV_ITEMS = [
  { key: "howItWorks", hash: "#how-it-works" },
  { key: "booking", hash: "#booking" },
  { key: "gallery", hash: "#gallery" },
  { key: "faq", hash: "#faq" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];

/*
 * The top bar when it is crowded (Session 51, S2-3): with Phones (the network, and so Announcements and the
 * network's badge) or the PINs (roles, and so the role chip) on, it holds more than 1024 or 1280 px give it.
 * Below 1680 px wide (where ON AIR and REC fit beside them too), its ghost buttons (Themes, Stream, Phones,
 * Announcements, Simple Mode) and the role chip then show their icon only: their words stay for screen readers,
 * and their tooltips say what they are. Screens and the Audience and Stage switches keep their words, as do the
 * states (LIVE, ON AIR, the network). Uncrowded, it is as it always was. Whole class names, so Tailwind finds them.
 */

/** A button's words, kept for screen readers only while it shows its icon alone. */
export const WORDS_IF_NARROW = 'max-[1680px]:sr-only';
/** That button, square, the height of the top bar's buttons. */
export const ICON_IF_NARROW = 'max-[1680px]:w-8 max-[1680px]:px-0';
/** That button with a count beside its icon (Announcements waiting). */
export const COUNT_IF_NARROW = 'max-[1680px]:px-2';

/**
 * Narrower still, below 1280 px (Session 51, S2-3's review): crowded, the states' panel holds ON AIR and REC (or
 * "On air · reconnecting", or No sound) beside the network's badge and LIVE only when the badge says its count
 * alone beside its icon and the ? beside Stream, Phones and Announcements go (each panel has its own ?).
 */
export const WORDS_IF_NARROWER = 'max-[1280px]:sr-only';
/** A ? beside a top bar button, gone below 1280 px while the top bar is crowded. */
export const HIDDEN_IF_NARROWER = 'max-[1280px]:hidden';

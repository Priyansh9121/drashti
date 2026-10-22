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

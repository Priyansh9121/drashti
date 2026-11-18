import { isOffered, OFFERED_ANIMATIONS } from './lower-third-studio';
import { MESSAGE_FIRST_ANIMATIONS } from './message-look';

/*
 * The animations a message's look offers (Session 55, Part 16), and those the one search box finds among them (Session
 * 59, X14: C13's search, where the animation is chosen, in Messages' look too).
 */

/** What the "Comes in and goes out" list offers: the ones a message offers first, then every other the studio offers. */
export interface MessageAnimationChoices {
  /** The ones a message offers first (their ids), in that order. */
  first: readonly string[];
  /** Every other the Lower Thirds studio offers (their ids), in its order. */
  more: readonly string[];
}

/** The ones a message offers first: those the studio still offers. */
const FIRST = MESSAGE_FIRST_ANIMATIONS.filter(isOffered);
/** Every other the studio offers. */
const MORE = OFFERED_ANIMATIONS.map((a) => a.id).filter((id) => !(FIRST as readonly string[]).includes(id));

/** What the list offers for what is typed in the box (nothing typed: all of it). */
export function messageAnimationChoices(_query: string): MessageAnimationChoices {
  return { first: FIRST, more: MORE };
}

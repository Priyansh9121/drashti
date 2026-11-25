import { create } from 'zustand';

/*
 * A stand-in for a22-chat-core's hook (proposed on the board, 11:3x): while Report a Problem takes the operator
 * window's picture, `held` is on, and the Chat section draws none of the chat's words or names. It goes when core's
 * hook is merged.
 */
export const usePictureHold = create<{ held: boolean }>(() => ({ held: false }));

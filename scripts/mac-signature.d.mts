/** The name of Drashti's own (self-signed, free) code-signing certificate, as the owner's steps make it. */
export const OWN_IDENTITY: string;
/** Drashti's id on a Mac (electron-builder.yml's appId). */
export const APP_ID: string;
export type OwnRequirement = { ok: true; sha1: string; slot: 'leaf' | 'root' } | { ok: false; why: string };
export function designatedRequirement(text: string): string | null;
export function ownRequirement(requirement: string | null, appId?: string): OwnRequirement;
export function signedBy(text: string): 'own' | 'ad-hoc' | 'developer-id' | 'other';
export function certificateSha1(der: Uint8Array): string;
export function ownSummary(builds: { dir: string; sha1: string; requirement: string }[]): string;

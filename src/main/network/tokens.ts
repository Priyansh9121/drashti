import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PAIRING_CODE_DIGITS } from '../../shared/network';

/*
 * Device tokens and pairing codes. A token is shown to its device once, when
 * it pairs; Drashti keeps only its SHA-256, so the library (and every backup
 * of it) holds nothing a device could be impersonated with.
 */

/** 256 random bits, as URL-safe text. */
export const newToken = (): string => randomBytes(32).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** A short code to type on the device: six random digits. */
export const newPairingCode = (): string =>
  String(randomInt(0, 10 ** PAIRING_CODE_DIGITS)).padStart(PAIRING_CODE_DIGITS, '0');

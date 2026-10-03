/**
 * Migration 16: built-in streaming (Session 9).
 *
 * A stream profile is where the stream goes (an RTMPS address), how (a
 * preset), and what it takes in: the camera, the sound input, a delay to
 * line the sound up with the picture, and whether Drashti's own sound goes
 * in too. The camera and sound input are kept as the stream's page saw them
 * (its id for the device and its name, to find it again if the id changes).
 *
 * There is still no key column, and there never will be: stream keys live
 * in the system's secure storage (Electron safeStorage), outside the
 * library, its backups and the diagnostics.
 */
export const up = `
ALTER TABLE stream_profiles ADD COLUMN preset TEXT NOT NULL DEFAULT 'good' CHECK (preset IN ('good', 'weak'));
ALTER TABLE stream_profiles ADD COLUMN camera TEXT CHECK (camera IS NULL OR json_valid(camera));
ALTER TABLE stream_profiles ADD COLUMN sound TEXT CHECK (sound IS NULL OR json_valid(sound));
ALTER TABLE stream_profiles ADD COLUMN sound_delay_ms INTEGER NOT NULL DEFAULT 0 CHECK (sound_delay_ms BETWEEN 0 AND 1000);
ALTER TABLE stream_profiles ADD COLUMN mix_own_sound INTEGER NOT NULL DEFAULT 0 CHECK (mix_own_sound IN (0, 1));
ALTER TABLE stream_profiles ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
`;

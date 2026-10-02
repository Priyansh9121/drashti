/**
 * Migration 10: the slide editor (Session 7).
 *
 * A presentation gets its own default transition (JSON, as slides already
 * have: {"kind":"dissolve","durationMs":800}) and whether auto-advance loops
 * from its last slide to its first. Both start empty, so every presentation
 * looks and plays as it did: no transition of its own means the app's
 * default, which starts as a cut.
 *
 * Nothing else changes shape. Slides already had a transition and an
 * auto-advance time, and elements a rotation, all unused until now. What is
 * new inside elements' props (shape kinds, outlines, full shadows,
 * shrink-to-fit, a video's sound) is optional, and left out means exactly
 * the look elements had before.
 */
export const up = `
ALTER TABLE presentations ADD COLUMN transition TEXT CHECK (transition IS NULL OR json_valid(transition));
ALTER TABLE presentations ADD COLUMN loop INTEGER NOT NULL DEFAULT 0 CHECK (loop IN (0, 1));
`;

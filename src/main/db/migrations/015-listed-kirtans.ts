/**
 * Migration 15: kirtan details kept on the presentation for the library list.
 *
 * Session 8's list joined `kirtans` to every presentation to send each
 * kirtan's details for the library filters, which made the list about
 * 2 ms slower at 5,000 presentations (a key lookup into `kirtans` per
 * presentation). The details are now kept on the presentation as one piece
 * of JSON, the way slide counts are kept (migration 5), and sent as it is:
 * the operator window reads it. Triggers keep it in step with `kirtans`
 * whatever writes there (the editor, the Kirtan dialog, an import, Undo,
 * a restore).
 */
const details = `json_object('category', NEW.category, 'kavi', NEW.kavi, 'raag', NEW.raag, 'occasions', json(NEW.occasions))`;

export const up = `
ALTER TABLE presentations ADD COLUMN kirtan TEXT CHECK (kirtan IS NULL OR json_valid(kirtan));
UPDATE presentations SET kirtan = (
  SELECT json_object('category', k.category, 'kavi', k.kavi, 'raag', k.raag, 'occasions', json(k.occasions))
    FROM kirtans k WHERE k.presentation_id = presentations.id
);
CREATE TRIGGER kirtans_listed_insert AFTER INSERT ON kirtans BEGIN
  UPDATE presentations SET kirtan = ${details} WHERE id = NEW.presentation_id;
END;
CREATE TRIGGER kirtans_listed_update AFTER UPDATE ON kirtans BEGIN
  UPDATE presentations SET kirtan = NULL WHERE id = OLD.presentation_id AND OLD.presentation_id <> NEW.presentation_id;
  UPDATE presentations SET kirtan = ${details} WHERE id = NEW.presentation_id;
END;
CREATE TRIGGER kirtans_listed_delete AFTER DELETE ON kirtans BEGIN
  UPDATE presentations SET kirtan = NULL WHERE id = OLD.presentation_id;
END;
`;

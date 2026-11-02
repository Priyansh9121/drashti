/** Immutable document originals, retained independently of presentation/media removal. */
export const up = `
CREATE TABLE document_originals (
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  ext TEXT NOT NULL CHECK (ext IN ('pdf', 'pptx', 'ppt', 'key')),
  bytes INTEGER NOT NULL CHECK (bytes > 0 AND bytes <= 1073741824),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (sha256, ext)
);
CREATE TABLE document_original_previews (
  sha256 TEXT NOT NULL,
  ext TEXT NOT NULL,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (sha256, ext, media_id),
  FOREIGN KEY (sha256, ext) REFERENCES document_originals(sha256, ext)
);
`;

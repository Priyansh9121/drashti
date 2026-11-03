/** Directly inserted PDFs retain their external protection even without a presentation row. */
export const up = `
CREATE TABLE document_original_locations (
  sha256 TEXT NOT NULL,
  ext TEXT NOT NULL,
  source_path TEXT NOT NULL,
  PRIMARY KEY (sha256, ext, source_path),
  FOREIGN KEY (sha256, ext) REFERENCES document_originals(sha256, ext)
);
`;

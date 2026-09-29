-- Search indexing now follows the include_in_global_search flag: only opted-in,
-- non-archived projects are indexed, and a nightly reconcile re-indexes any
-- opted-in project that changed since it was last fully indexed.
-- NULL = never fully indexed. Compared against projects.updated_at (both are
-- datetime('now') strings, so they sort correctly as text).
ALTER TABLE projects ADD COLUMN search_indexed_at TEXT;

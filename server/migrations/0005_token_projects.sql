-- Adds an optional per-token project allow-list. NULL (the default for
-- every existing row) means "all projects" — today's behavior, unchanged.
-- A non-null value is a JSON-encoded array of project slugs; enforcement
-- lives in code (modules/tokens's canAccessProject), not in this schema.
ALTER TABLE api_tokens ADD COLUMN projects TEXT;

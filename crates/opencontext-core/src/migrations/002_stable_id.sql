-- Add stable_id to docs if missing (idempotent via IF NOT EXISTS on index)
-- The column addition is guarded in the migration runner
CREATE UNIQUE INDEX IF NOT EXISTS idx_docs_stable_id ON docs(stable_id);

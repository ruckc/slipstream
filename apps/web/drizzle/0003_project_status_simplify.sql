-- Migrate any projects stuck in 'running' or 'stopping' back to 'starting' or 'stopped'.
-- 'running' → 'starting' (deployment is still scaled up; agent will shut down on idle timeout)
-- 'stopping' → 'stopped' (treat as stopped since we can no longer track the transition)
UPDATE projects SET status = 'starting' WHERE status = 'running';
UPDATE projects SET status = 'stopped'  WHERE status = 'stopping';

-- Tighten the check constraint to only the two user-intent states.
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
  CHECK (status IN ('stopped', 'starting'));

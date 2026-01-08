BEGIN;

-- ================================
-- user_tasks: منع تكرار المهمة
-- ================================
ALTER TABLE user_tasks
ADD CONSTRAINT unique_user_task
UNIQUE (user_id, task_id);

-- ================================
-- task_proofs: إثبات واحد Pending فقط
-- ================================
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_proof
ON task_proofs (user_id, task_id)
WHERE status = 'pending';

-- ================================
-- Indexes لتحسين الأداء
-- ================================
CREATE INDEX IF NOT EXISTS idx_user_tasks_user
ON user_tasks (user_id);

CREATE INDEX IF NOT EXISTS idx_user_tasks_task
ON user_tasks (task_id);

CREATE INDEX IF NOT EXISTS idx_task_proofs_task
ON task_proofs (task_id);

CREATE INDEX IF NOT EXISTS idx_task_proofs_status
ON task_proofs (status);

COMMIT;

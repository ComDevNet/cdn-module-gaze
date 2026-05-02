-- Run once in the same database as Module Gaze if you applied the old migration
-- that created `modulegaze_user_pool` (now replaced by the `User` model).
DROP TABLE IF EXISTS "modulegaze_user_pool";

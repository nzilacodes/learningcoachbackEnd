import { sql } from "./src/db/sql.js";

const tables = await sql`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name IN ('lesson_attempts','exercise_attempt_results','user_hearts')
  ORDER BY table_name
`;
console.log("New tables:", tables.map(r => r.table_name));

const exCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='exercises'
    AND column_name IN ('content_status','generated_by','generation_batch_id','reviewed_by','reviewed_at')
  ORDER BY column_name
`;
console.log("exercises new columns:", exCols.map(r => r.column_name));

const lesCols = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='lessons'
    AND column_name IN ('min_pass_score','hearts_enabled')
  ORDER BY column_name
`;
console.log("lessons new columns:", lesCols.map(r => r.column_name));

const counts = await sql`
  SELECT
    (SELECT count(*) FROM public.lessons) AS total_lessons,
    (SELECT count(*) FROM public.exercises) AS total_exercises,
    (SELECT count(*) FROM public.exercises WHERE content_status='published') AS published_exercises
`;
console.log("counts:", counts[0]);

await sql.end();

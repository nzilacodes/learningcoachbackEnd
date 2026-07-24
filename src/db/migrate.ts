import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "./sql.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "../../supabase/migrations");

async function main() {
  await sql`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  const applied = new Set((await sql<{ filename: string }[]>`SELECT filename FROM public.schema_migrations`).map((r) => r.filename));

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  let ranCount = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const contents = await readFile(path.join(migrationsDir, file), "utf8");
    console.log(`Applying ${file}...`);
    await sql.begin(async (tx) => {
      await tx.unsafe(contents);
      await tx`INSERT INTO public.schema_migrations (filename) VALUES (${file})`;
    });
    ranCount++;
  }

  console.log(ranCount === 0 ? "Already up to date." : `Applied ${ranCount} migration(s).`);
  await sql.end();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});

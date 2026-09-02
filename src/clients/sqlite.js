// Shared read-only SQLite opener for client parsers (OpenCode, ZCode).
// `node:sqlite` requires Node >= 22.5, so it is imported dynamically and this
// helper throws on older Node — callers catch that and fall back to their
// legacy file layout with a warning (the db-first guard stays in each
// parser; this only centralizes the open boilerplate).

export async function openSqliteReadOnly(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true });
}

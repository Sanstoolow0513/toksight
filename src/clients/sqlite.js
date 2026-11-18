// Shared read-only SQLite opener for client parsers (OpenCode, ZCode).
// `node:sqlite` is available in all supported Node versions. Keep the dynamic
// import so callers can catch open failures and use their legacy file layout.

export async function openSqliteReadOnly(dbPath) {
  const { DatabaseSync } = await import('node:sqlite');
  return new DatabaseSync(dbPath, { readOnly: true });
}

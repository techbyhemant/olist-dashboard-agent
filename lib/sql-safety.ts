/**
 * SQL safety gate for model-generated queries.
 *
 * The model is *instructed* to emit read-only SELECTs, but instruction is not
 * enforcement — `query()` would run whatever string it's given. This module is
 * the enforcement: a query must be a SINGLE read-only SELECT (or WITH…SELECT),
 * and may not call file-access functions. Applied both as a Zod refinement on the
 * spec contract (so violations fail validation and feed the retry loop) and as a
 * last-line assert immediately before execution (defense in depth).
 *
 * This is allowlist-first: rather than chase a denylist of every dangerous verb,
 * we require the statement to START with SELECT/WITH and be a single statement —
 * which structurally excludes INSERT/UPDATE/DELETE/DROP/COPY/ATTACH/PRAGMA/etc.
 */

/** Remove comments and single-quoted string literals so keywords inside data don't trip checks. */
function stripCommentsAndStrings(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ') // line comments
    .replace(/\/\*[\s\S]*?\*\//g, ' ') // block comments
    .replace(/'(?:''|[^'])*'/g, "''"); // '...'-strings -> empty literal
}

// DuckDB functions that read from the filesystem/network — must not appear in
// model SQL (our table views already wrap the CSVs; the model queries by name).
const FILE_FUNCTIONS =
  /\b(read_csv(_auto)?|read_parquet|read_json(_auto)?|read_ndjson|read_text|read_blob|glob|parquet_scan|csv_scan)\s*\(/i;

export type SafetyCheck = { ok: true } | { ok: false; reason: string };

export function checkSafeSelect(sql: string): SafetyCheck {
  const stripped = stripCommentsAndStrings(sql);

  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (statements.length === 0) {
    return { ok: false, reason: 'empty SQL' };
  }
  if (statements.length > 1) {
    return { ok: false, reason: 'only a single statement is allowed (found multiple ";"-separated statements)' };
  }

  const stmt = statements[0];
  if (!/^\s*(with|select)\b/i.test(stmt)) {
    return { ok: false, reason: 'query must be read-only and start with SELECT or WITH' };
  }
  if (FILE_FUNCTIONS.test(stripped)) {
    return { ok: false, reason: 'file-access functions (read_csv/parquet/json/text/blob/glob…) are not allowed' };
  }

  return { ok: true };
}

export function isSafeSelect(sql: string): boolean {
  return checkSafeSelect(sql).ok;
}

/** Throws with a clear message if the SQL is not a safe read-only SELECT. */
export function assertSafeSelect(sql: string, label = 'query'): void {
  const result = checkSafeSelect(sql);
  if (!result.ok) {
    throw new Error(`Unsafe SQL rejected (${label}): ${result.reason}`);
  }
}

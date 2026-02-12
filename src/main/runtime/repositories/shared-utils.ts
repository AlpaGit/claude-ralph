import { createHash } from "node:crypto";
import { normalize } from "node:path";

/**
 * Custom error thrown when JSON columns in the database fail to parse.
 * Carries the plan/task context so callers can diagnose corrupt data.
 */
export class PlanParseError extends Error {
  constructor(
    public readonly field: string,
    public readonly entityId: string,
    public readonly cause: unknown
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to parse ${field} for plan ${entityId}: ${causeMsg}`);
    this.name = "PlanParseError";
  }
}

/**
 * Parse a JSON string expected to contain a string array (e.g. dependencies, acceptance criteria).
 * On parse failure, logs a descriptive warning and throws a PlanParseError so the caller can
 * surface the problem rather than silently dropping data.
 *
 * @param value  - Raw JSON string from the database column.
 * @param field  - Column name (for error context).
 * @param entityId - The plan or task ID that owns the row (for error context).
 */
export const parseJsonArray = (value: string | null | undefined, field: string, entityId: string): string[] => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch (error: unknown) {
    console.error(`[AppDatabase] Failed to parse ${field} for entity ${entityId}: ${error instanceof Error ? error.message : String(error)}`);
    throw new PlanParseError(field, entityId, error);
  }
};

/** Return the current time as an ISO 8601 string. */
export const nowIso = (): string => new Date().toISOString();

/**
 * Derive a stable, deterministic project key from a file-system path.
 * Normalises separators, lowercases, and trims whitespace so that
 * `C:\Users\foo\project` and `C:/Users/foo/project` resolve identically.
 */
export function normalizeProjectKey(projectPath: string): string {
  const trimmed = projectPath.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const normalized = normalize(trimmed).replace(/[\\/]+/g, "/").trim();
  if (normalized.length === 0) {
    return "";
  }

  return normalized.toLowerCase();
}

/**
 * Build a deterministic project ID from a project key using SHA-1.
 * Produces IDs in the form `proj-<24-char hex>`.
 */
export function buildStableProjectId(projectKey: string): string {
  const digest = createHash("sha1").update(projectKey).digest("hex");
  return `proj-${digest.slice(0, 24)}`;
}

/**
 * Derive a human-friendly display name from a project file path.
 * Returns the last path segment, falling back to the full path or "Unnamed project".
 */
export function deriveProjectDisplayName(projectPath: string): string {
  const normalized = projectPath.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  if (normalized.length === 0) {
    return "Unnamed project";
  }

  const parts = normalized.split("/");
  const last = parts[parts.length - 1]?.trim();
  return last && last.length > 0 ? last : normalized;
}

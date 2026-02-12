import type { IpcError } from "@shared/types";

/**
 * Attempt to parse a structured IpcError from a caught error.
 *
 * IPC handler errors arrive as Error objects whose .message contains
 * a JSON-serialized IpcError (produced by createIpcError in main/ipc.ts).
 * If the message is valid JSON conforming to the IpcError shape, this
 * function returns the parsed structure. Otherwise it returns a fallback
 * IpcError with the raw message string and code "UNKNOWN_ERROR".
 */
export function parseIpcError(caught: unknown): IpcError {
  const rawMessage = caught instanceof Error ? caught.message : String(caught);

  // Electron prefixes IPC errors with "Error invoking remote method 'channel': "
  // followed by "Error: <original message>". Try to extract the JSON payload.
  const jsonCandidate = extractJsonFromMessage(rawMessage);

  if (jsonCandidate) {
    try {
      const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
      if (
        typeof parsed.message === "string" &&
        typeof parsed.code === "string"
      ) {
        return parsed as unknown as IpcError;
      }
    } catch {
      // Not valid JSON -- fall through to plain error
    }
  }

  return {
    message: rawMessage,
    code: "UNKNOWN_ERROR"
  };
}

/**
 * Extract a JSON object string from an Electron IPC error message.
 *
 * Electron wraps thrown errors from ipcMain.handle with:
 *   "Error invoking remote method '<channel>': Error: <original message>"
 *
 * The original message is our JSON-serialized IpcError.
 * This function tries to find the first '{' and extract balanced JSON from there.
 */
function extractJsonFromMessage(message: string): string | null {
  const firstBrace = message.indexOf("{");
  if (firstBrace === -1) return null;

  // Find the matching closing brace (simple brace counting)
  let depth = 0;
  for (let i = firstBrace; i < message.length; i++) {
    if (message[i] === "{") depth++;
    else if (message[i] === "}") depth--;
    if (depth === 0) {
      return message.slice(firstBrace, i + 1);
    }
  }

  return null;
}

/**
 * Extract a human-readable message from a caught IPC error.
 * This is the simple path used by stores that only need the message string.
 */
export function getIpcErrorMessage(caught: unknown): string {
  const ipcError = parseIpcError(caught);
  return ipcError.message;
}

/**
 * Check whether a parsed IpcError has developer details
 * (validation issues or stack trace).
 */
export function hasIpcErrorDetails(error: IpcError): boolean {
  return !!(error.details?.length || error.stack);
}

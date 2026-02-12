/**
 * Unit tests for TaskRunner.testDiscordWebhook().
 *
 * Tests the Discord webhook test flow: payload construction, HTTP fetch behavior,
 * success/error handling, timeout, and the distinctive test embed format.
 *
 * Uses a real in-memory AppDatabase to construct the TaskRunner, with
 * globalThis.fetch mocked via vi.fn() to intercept outgoing requests.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "node:path";
import { TaskRunner } from "../../src/main/runtime/task-runner";
import { AppDatabase } from "../../src/main/runtime/app-database";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = resolve(__dirname, "../../src/main/runtime/migrations");
const TEST_WEBHOOK_URL = "https://discord.com/api/webhooks/123456/abcdef";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let db: AppDatabase;
let taskRunner: TaskRunner;
let originalFetch: typeof globalThis.fetch;

function mockFetchOk(): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve("")
  });
  globalThis.fetch = mock;
  return mock;
}

function mockFetchError(status: number, body: string): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body)
  });
  globalThis.fetch = mock;
  return mock;
}

function mockFetchThrow(error: Error): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockRejectedValue(error);
  globalThis.fetch = mock;
  return mock;
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  originalFetch = globalThis.fetch;
  db = new AppDatabase(":memory:", MIGRATIONS_DIR);
  taskRunner = new TaskRunner(db, () => null);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  db.close();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TaskRunner.testDiscordWebhook", () => {
  it("returns { ok: true } when Discord responds with 200", async () => {
    const fetchMock = mockFetchOk();

    const result = await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends POST request to the provided webhook URL", async () => {
    const fetchMock = mockFetchOk();

    await taskRunner.testDiscordWebhook({ webhookUrl: TEST_WEBHOOK_URL });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(TEST_WEBHOOK_URL);
    expect(options.method).toBe("POST");
    expect(options.headers["content-type"]).toBe("application/json");
  });

  it("builds a valid Discord embed payload with green/teal color 0x10b981", async () => {
    const fetchMock = mockFetchOk();

    await taskRunner.testDiscordWebhook({ webhookUrl: TEST_WEBHOOK_URL });

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);

    // Payload structure
    expect(payload.username).toBe("Ralph");
    expect(payload.embeds).toHaveLength(1);
    expect(payload.allowed_mentions).toEqual({ parse: [] });

    // Embed properties
    const embed = payload.embeds[0];
    expect(embed.color).toBe(0x10b981);
    expect(embed.title).toContain("Webhook Test");
    expect(embed.description).toContain("Ralph Desktop");
    expect(embed.description).toContain("configured correctly");
    expect(embed.timestamp).toBeDefined();
    expect(embed.author.name).toBe("Ralph");
    expect(embed.footer.text).toContain("Test Notification");

    // Fields
    expect(embed.fields).toBeDefined();
    expect(embed.fields.length).toBeGreaterThanOrEqual(2);
    const statusField = embed.fields.find((f: { name: string }) => f.name === "Status");
    expect(statusField?.value).toBe("Connected");
    const sentAtField = embed.fields.find((f: { name: string }) => f.name === "Sent At");
    expect(sentAtField?.value).toBeDefined();
  });

  it("includes a DiceBear avatar URL for speaker 'Ralph'", async () => {
    const fetchMock = mockFetchOk();

    await taskRunner.testDiscordWebhook({ webhookUrl: TEST_WEBHOOK_URL });

    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body);
    expect(payload.avatar_url).toContain("dicebear.com");
    expect(payload.avatar_url).toContain("ralph");
  });

  it("returns error result when Discord responds with non-200 status", async () => {
    mockFetchError(401, "Unauthorized");

    const result = await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("401");
    expect(result.error).toContain("Unauthorized");
  });

  it("returns error result when Discord responds with 404", async () => {
    mockFetchError(404, "Unknown Webhook");

    const result = await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
    expect(result.error).toContain("Unknown Webhook");
  });

  it("truncates long error response bodies to 180 characters", async () => {
    const longBody = "X".repeat(500);
    mockFetchError(500, longBody);

    const result = await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    expect(result.ok).toBe(false);
    expect(result.error!.length).toBeLessThan(250); // status prefix + truncated body
  });

  it("returns error result on network failure", async () => {
    mockFetchThrow(new Error("ECONNREFUSED"));

    const result = await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("returns error result on non-Error throw", async () => {
    const mock = vi.fn().mockRejectedValue("string error");
    globalThis.fetch = mock;

    const result = await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("string error");
  });

  it("includes an AbortSignal in the fetch request (timeout support)", async () => {
    const fetchMock = mockFetchOk();

    await taskRunner.testDiscordWebhook({ webhookUrl: TEST_WEBHOOK_URL });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.signal).toBeDefined();
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns graceful error when globalThis.fetch is unavailable", async () => {
    // Temporarily remove fetch
    const savedFetch = globalThis.fetch;
    (globalThis as Record<string, unknown>).fetch = undefined;

    try {
      const result = await taskRunner.testDiscordWebhook({
        webhookUrl: TEST_WEBHOOK_URL
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("fetch");
    } finally {
      globalThis.fetch = savedFetch;
    }
  });

  it("does not read webhook URL from database (uses provided input URL)", async () => {
    // Set a different URL in the database
    db.updateAppSettings({
      discordWebhookUrl: "https://different-url.com/webhook"
    });

    const fetchMock = mockFetchOk();

    await taskRunner.testDiscordWebhook({
      webhookUrl: TEST_WEBHOOK_URL
    });

    // Should use the input URL, not the one from the DB
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(TEST_WEBHOOK_URL);
  });
});

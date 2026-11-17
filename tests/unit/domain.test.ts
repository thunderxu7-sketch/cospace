import { describe, it, expect } from "vitest";
import { validWindow, overlaps, taskPatch, aiTasks } from "../../server/domain";
import { readStream } from "../../src/lib/api";
describe("time and version boundaries", () => {
  it("accepts unscheduled tasks, rejects half or inverted windows", () => {
    expect(validWindow(null, null)).toBe(true);
    expect(validWindow("2026-11-23T01:00:00Z", null)).toBe(false);
    expect(validWindow("2026-11-23T02:00:00Z", "2026-11-23T01:00:00Z")).toBe(
      false,
    );
    expect(
      validWindow("2026-11-23T09:00:00+08:00", "2026-11-23T02:00:00Z"),
    ).toBe(true);
  });
  it("allows adjacent slots and different owners, detects timezone-equivalent overlap", () => {
    const a = {
      assignee: "lin",
      start_at: "2026-11-23T09:00:00+08:00",
      end_at: "2026-11-23T10:00:00+08:00",
    };
    expect(
      overlaps(a, {
        ...a,
        start_at: "2026-11-23T02:00:00Z",
        end_at: "2026-11-23T03:00:00Z",
      }),
    ).toBe(false);
    expect(overlaps(a, { ...a, assignee: "chen" })).toBe(false);
    expect(overlaps(a, { ...a, start_at: "2026-11-23T01:30:00Z" })).toBe(true);
  });
  it("requires versions and rejects extra mutation fields or hallucinated assignees", () => {
    expect(taskPatch.safeParse({ status: "done" }).success).toBe(false);
    expect(
      taskPatch.safeParse({ version: 1, source: "invented" }).success,
    ).toBe(false);
    expect(
      taskPatch.safeParse({ version: 1, start_at: "2026-11-23 09:00" }).success,
    ).toBe(false);
    expect(
      aiTasks.safeParse({ tasks: [{ title: "Review", assignee: "nobody" }] })
        .success,
    ).toBe(false);
  });
});
describe("incremental NDJSON reader", () => {
  it("preserves Chinese text even when every UTF-8 byte arrives separately", async () => {
    const bytes = new TextEncoder().encode(
      '{"type":"delta","text":"你好，团队"}\n{"type":"proposal"}',
    );
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const b of bytes) c.enqueue(Uint8Array.of(b));
        c.close();
      },
    });
    const got = [];
    for await (const e of readStream(stream)) got.push(e);
    expect(got).toEqual([
      { type: "delta", text: "你好，团队" },
      { type: "proposal" },
    ]);
  });
  it("cancels the underlying stream when the consumer stops", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"type":"start"}\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of readStream(stream)) break;
    expect(cancelled).toBe(true);
  });
});

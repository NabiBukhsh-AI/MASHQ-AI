import { describe, it, expect } from "vitest";
import { getContentStatus } from "./status";

describe("Content Status", () => {
  it("returns null for unknown content", async () => {
    const status = await getContentStatus("unknown");
    expect(status).toBeNull();
  });

  it("returns ready status for valid content", async () => {
    const status = await getContentStatus("doc1");
    expect(status?.status).toBe("ready");
    expect(status?.progress).toBe(100);
  });
});

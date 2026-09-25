import { describe, it, expect } from "vitest";
import { uploadSourceFile, getSourceFile } from "./blob";

describe("Blob Store", () => {
  it("uploads a file and returns a mock url", async () => {
    const url = await uploadSourceFile(Buffer.from("test"), "test.txt");
    expect(url).toContain("mock-blob-url");
    expect(url).toContain("test.txt");
  });

  it("gets a source file", async () => {
    const blob = await getSourceFile("mock-url");
    expect(blob).toBeDefined();
  });
});

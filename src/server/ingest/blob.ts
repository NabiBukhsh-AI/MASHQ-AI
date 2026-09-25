import { put } from "@vercel/blob";
import crypto from "crypto";

export async function uploadSourceFile(buffer: Buffer, originalName: string): Promise<string> {
  // In a real app we'd upload to vercel blob
  // return (await put(originalName, buffer, { access: 'public' })).url;

  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  const filename = `${hash}-${originalName}`;

  return `mock-blob-url/${filename}`;
}

export async function getSourceFile(url: string): Promise<Blob> {
  // Mock fetch
  return new Blob(["mock data"]);
}

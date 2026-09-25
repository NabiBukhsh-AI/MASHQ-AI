export function checkMagicBytes(bytes: Uint8Array, mimeType: string, filename?: string): boolean {
  if (bytes.length === 0) return false;

  const ext = filename?.toLowerCase().split(".").pop() || "";
  const type = mimeType.toLowerCase();

  // PDF check: starts with %PDF (0x25, 0x50, 0x44, 0x46)
  if (type === "application/pdf" || ext === "pdf") {
    if (bytes.length < 4) return false;
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }

  // Office OpenXML / ZIP check: starts with PK\x03\x04 or PK\x05\x06
  if (
    type.includes("officedocument") ||
    type === "application/zip" ||
    ext === "docx" ||
    ext === "pptx" ||
    ext === "zip"
  ) {
    if (bytes.length < 4) return false;
    const isStandardZip =
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    const isEmptyZip =
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06;
    return isStandardZip || isEmptyZip;
  }

  // Text / Markdown checks: text files should not contain binary NUL bytes
  if (
    type.startsWith("text/") ||
    type === "application/json" ||
    ext === "txt" ||
    ext === "md" ||
    ext === "json"
  ) {
    // Reject if it matches known binary signatures
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    ) {
      return false; // Binary PDF disguised as text
    }
    if (
      bytes.length >= 4 &&
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    ) {
      return false; // Binary ZIP disguised as text
    }

    // Inspect up to first 8192 bytes for NUL bytes
    const inspectLength = Math.min(bytes.length, 8192);
    for (let i = 0; i < inspectLength; i++) {
      if (bytes[i] === 0) {
        return false;
      }
    }
    return true;
  }

  return false;
}

export function validateFileType(
  bytes: Uint8Array,
  mimeType: string,
  filename?: string,
): { valid: boolean; reason?: string } {
  if (bytes.length === 0) {
    return { valid: false, reason: "Uploaded file is empty." };
  }

  const isValid = checkMagicBytes(bytes, mimeType, filename);
  if (!isValid) {
    return {
      valid: false,
      reason: "File signature does not match the expected format or contains invalid binary data.",
    };
  }

  return { valid: true };
}

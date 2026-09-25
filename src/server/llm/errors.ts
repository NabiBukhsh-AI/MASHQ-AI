export type LlmErrorCode =
  | "budget_exceeded"
  | "spend_blocked"
  | "timeout"
  | "first_token_timeout"
  | "provider_error"
  | "rate_limited"
  | "invalid_output"
  | "refusal"
  | "aborted"
  | "no_route";

export class LlmError extends Error {
  constructor(
    public readonly code: LlmErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmError";
  }
}

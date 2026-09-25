export type ErrorDetail = { path: string; message: string };

/**
 * An error safe to show to the client. `publicMessage` says what happened and
 * what to do next; anything sensitive stays in the server log.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly publicMessage: string,
    public readonly details?: ErrorDetail[],
    public readonly headers?: Record<string, string>,
  ) {
    super(publicMessage);
    this.name = "AppError";
  }
}

export const errors = {
  badRequest: (message: string, details?: ErrorDetail[]) =>
    new AppError("BAD_REQUEST", 400, message, details),
  unauthorized: (message = "Sign in to continue.") => new AppError("UNAUTHORIZED", 401, message),
  forbidden: (message = "You do not have access to this.") =>
    new AppError("FORBIDDEN", 403, message),
  notFound: (message = "Not found.") => new AppError("NOT_FOUND", 404, message),
  conflict: (message: string) => new AppError("CONFLICT", 409, message),
  tooManyRequests: (retryAfterSeconds: number) =>
    new AppError(
      "RATE_LIMITED",
      429,
      `Too many requests. Try again in ${retryAfterSeconds} seconds.`,
      undefined,
      { "Retry-After": String(retryAfterSeconds) },
    ),
};

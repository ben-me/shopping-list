/**
 * The API error envelope. Every endpoint fails through the same shape so
 * clients (and the web app's `apiFetch`) need to understand only one contract.
 */
export interface ApiErrorEnvelope {
  error: {
    status: number;
    code: string;
    message: string;
  };
}

export interface SerializedApiError {
  status: number;
  envelope: ApiErrorEnvelope;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export class BadRequestError extends ApiError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(message = "Sign in to continue") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends ApiError {
  constructor(message = "You are not a member of this list") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends ApiError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

/**
 * Map any thrown value to the shared envelope. Known {@link ApiError}s keep
 * their status, code, and message; anything else collapses to a generic 500 so
 * internal details never leak to the client.
 */
export function toErrorEnvelope(error: unknown): SerializedApiError {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      envelope: { error: { status: error.status, code: error.code, message: error.message } },
    };
  }
  return {
    status: 500,
    envelope: { error: { status: 500, code: "internal", message: "Internal server error" } },
  };
}

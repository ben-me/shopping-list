import { describe, expect, it } from "vitest";
import {
  ApiError,
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  toErrorEnvelope,
} from "./errors";

describe("error envelope", () => {
  it("wraps an ApiError with its status, code, and message", () => {
    const error = new ApiError(400, "bad_request", "Something was wrong");

    const { status, envelope } = toErrorEnvelope(error);

    expect(status).toBe(400);
    expect(envelope).toEqual({
      error: { status: 400, code: "bad_request", message: "Something was wrong" },
    });
  });

  it("keeps each guard error's status and code", () => {
    expect(toErrorEnvelope(new UnauthorizedError()).envelope.error).toEqual({
      status: 401,
      code: "unauthorized",
      message: "Sign in to continue",
    });
    expect(toErrorEnvelope(new ForbiddenError()).envelope.error).toMatchObject({
      status: 403,
      code: "forbidden",
    });
    expect(toErrorEnvelope(new BadRequestError("List name is required")).envelope.error).toEqual({
      status: 400,
      code: "bad_request",
      message: "List name is required",
    });
    expect(toErrorEnvelope(new NotFoundError()).envelope.error).toMatchObject({
      status: 404,
      code: "not_found",
    });
  });

  it("collapses unknown errors to a 500 without leaking the message", () => {
    const { status, envelope } = toErrorEnvelope(new Error("sensitive internals"));

    expect(status).toBe(500);
    expect(envelope).toEqual({
      error: { status: 500, code: "internal", message: "Internal server error" },
    });
    expect(envelope.error.message).not.toContain("sensitive");
  });
});

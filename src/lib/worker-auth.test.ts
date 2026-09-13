import { describe, it, expect } from "vitest";
import { getBearerToken, getSessionToken } from "./worker-auth";

function req(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/x", { headers });
}

describe("getBearerToken", () => {
  it("extracts a Bearer token case-insensitively", () => {
    expect(getBearerToken(req({ authorization: "Bearer abc123" }))).toBe("abc123");
    expect(getBearerToken(req({ authorization: "bearer xyz" }))).toBe("xyz");
  });
  it("rejects non-Bearer schemes and missing headers", () => {
    expect(getBearerToken(req({ authorization: "Basic abc" }))).toBeNull();
    expect(getBearerToken(req({ authorization: "Bearer " }))).toBeNull();
    expect(getBearerToken(req({}))).toBeNull();
  });
  it("does not accept the token as a query param or body field", () => {
    expect(
      getBearerToken(new Request("http://localhost/api/x?token=abc")),
    ).toBeNull();
  });
});

describe("getSessionToken", () => {
  it("prefers the Bearer token over the cookie", () => {
    const r = req({ authorization: "Bearer header-tok", cookie: "sufra_worker_session=cookie-tok" });
    expect(getSessionToken(r)).toBe("header-tok");
  });
  it("falls back to the HttpOnly cookie", () => {
    expect(getSessionToken(req({ cookie: "other=1; sufra_worker_session=cookie-tok; x=2" }))).toBe("cookie-tok");
  });
  it("ignores lookalike cookie names", () => {
    expect(getSessionToken(req({ cookie: "sufra_worker_session_evil=1; x_sufra_worker_session=2" }))).toBeNull();
  });
  it("returns null when no credential is present", () => {
    expect(getSessionToken(req({}))).toBeNull();
    expect(getSessionToken(req({ cookie: "sufra_worker_session=" }))).toBeNull();
  });
});

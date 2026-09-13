import { describe, it, expect, beforeEach } from "vitest";
import { checkRateLimit, clientIp } from "./rate-limit";

function reqWithIp(ip: string): Request {
  return new Request("http://localhost/api/x", {
    headers: { "x-forwarded-for": ip },
  });
}

describe("clientIp", () => {
  it("uses the first x-forwarded-for entry", () => {
    expect(clientIp(reqWithIp("1.2.3.4, 5.6.7.8"))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip", () => {
    const r = new Request("http://localhost/", { headers: { "x-real-ip": "9.9.9.9" } });
    expect(clientIp(r)).toBe("9.9.9.9");
  });
  it("falls back to loopback", () => {
    expect(clientIp(new Request("http://localhost/"))).toBe("127.0.0.1");
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => {
    process.env.SUFRA_RATE_LIMIT_DISABLED = "0";
  });

  it("allows requests under the limit", () => {
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(reqWithIp("10.0.0.1"), "test", { limit: 3, windowMs: 60_000 }).ok).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit and reports retry-after", () => {
    const opts = { limit: 2, windowMs: 60_000 };
    for (let i = 0; i < 2; i++) {
      expect(checkRateLimit(reqWithIp("10.0.0.2"), "test", opts).ok).toBe(true);
    }
    const blocked = checkRateLimit(reqWithIp("10.0.0.2"), "test", opts);
    expect(!blocked.ok && blocked.retryAfterSeconds).toBeGreaterThan(0);
    expect(checkRateLimit(reqWithIp("10.0.0.2"), "test", opts).ok).toBe(false);
  });

  it("keys by IP, not globally", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit(reqWithIp("10.0.0.3"), "test", opts).ok).toBe(true);
    expect(checkRateLimit(reqWithIp("10.0.0.4"), "test", opts).ok).toBe(true);
  });

  it("separates namespaces", () => {
    const opts = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit(reqWithIp("10.0.0.5"), "login", opts).ok).toBe(true);
    expect(checkRateLimit(reqWithIp("10.0.0.5"), "scan", opts).ok).toBe(true);
  });

  it("is disabled via SUFRA_RATE_LIMIT_DISABLED", () => {
    process.env.SUFRA_RATE_LIMIT_DISABLED = "1";
    const opts = { limit: 0, windowMs: 60_000 };
    expect(checkRateLimit(reqWithIp("10.0.0.6"), "test", opts).ok).toBe(true);
  });
});
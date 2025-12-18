import { describe, it, expect } from "vitest";
import { parseOAuthCallbackURL } from "./manual-auth";

describe("parseOAuthCallbackURL", () => {
  it("should parse a valid callback URL with all parameters", () => {
    const url =
      "http://localhost:51121/oauth-callback?state=eyJ2ZXJpZmllciI6IkhUY3drdU5hV1dKcm9oakgwbXotaHB2V3NDamtyNWdJQUUtOHZXUXRzZm8iLCJwcm9qZWN0SWQiOiIifQ&code=4/0ATX87lNPy3jJEDUUykk_gAnd0O0oSOaEn6w_BWZWKyo7CNadics6InfEjkRbhbs4n94X9Q&scope=email%20profile%20https://www.googleapis.com/auth/cloud-platform";

    const result = parseOAuthCallbackURL(url);

    expect(result.code).toBe("4/0ATX87lNPy3jJEDUUykk_gAnd0O0oSOaEn6w_BWZWKyo7CNadics6InfEjkRbhbs4n94X9Q");
    expect(result.state).toBe(
      "eyJ2ZXJpZmllciI6IkhUY3drdU5hV1dKcm9oakgwbXotaHB2V3NDamtyNWdJQUUtOHZXUXRzZm8iLCJwcm9qZWN0SWQiOiIifQ"
    );
    expect(result.scope).toContain("email");
  });

  it("should parse URL without scope parameter", () => {
    const url =
      "http://localhost:51121/oauth-callback?state=test-state&code=test-code";

    const result = parseOAuthCallbackURL(url);

    expect(result.code).toBe("test-code");
    expect(result.state).toBe("test-state");
    expect(result.scope).toBeUndefined();
  });

  it("should handle URLs with authuser and prompt parameters", () => {
    const url =
      "http://localhost:51121/oauth-callback?state=test-state&code=test-code&authuser=3&prompt=consent";

    const result = parseOAuthCallbackURL(url);

    expect(result.code).toBe("test-code");
    expect(result.state).toBe("test-state");
  });

  it("should throw error when code is missing", () => {
    const url = "http://localhost:51121/oauth-callback?state=test-state";

    expect(() => parseOAuthCallbackURL(url)).toThrow("Missing 'code' parameter");
  });

  it("should throw error when state is missing", () => {
    const url = "http://localhost:51121/oauth-callback?code=test-code";

    expect(() => parseOAuthCallbackURL(url)).toThrow("Missing 'state' parameter");
  });

  it("should throw error for invalid URL format", () => {
    const url = "not-a-valid-url";

    expect(() => parseOAuthCallbackURL(url)).toThrow("Invalid callback URL");
  });

  it("should handle OAuth error responses", () => {
    const url =
      "http://localhost:51121/oauth-callback?error=access_denied&error_description=User%20denied%20access";

    expect(() => parseOAuthCallbackURL(url)).toThrow("OAuth error: User denied access");
  });

  it("should handle OAuth error without description", () => {
    const url = "http://localhost:51121/oauth-callback?error=invalid_request";

    expect(() => parseOAuthCallbackURL(url)).toThrow("OAuth error: invalid_request");
  });

  it("should parse URLs with different localhost ports", () => {
    const url = "http://localhost:8080/oauth-callback?state=test-state&code=test-code";

    const result = parseOAuthCallbackURL(url);

    expect(result.code).toBe("test-code");
    expect(result.state).toBe("test-state");
  });

  it("should handle URLs with fragment identifiers", () => {
    const url =
      "http://localhost:51121/oauth-callback?state=test-state&code=test-code#fragment";

    const result = parseOAuthCallbackURL(url);

    expect(result.code).toBe("test-code");
    expect(result.state).toBe("test-state");
  });
});
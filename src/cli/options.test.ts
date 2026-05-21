import { describe, expect, it } from "vitest";
import { flagNameForParam, optionKeyForParam, optionValueForParam } from "./options.js";

describe("CLI option helpers", () => {
  it("trims invalid leading and trailing hyphens from flag names", () => {
    expect(flagNameForParam("custom-meta-")).toBe("custom-meta");
  });

  it("maps hyphenated flags back to original OpenAPI parameter names", () => {
    expect(optionKeyForParam("request-id")).toBe("requestId");
    expect(optionValueForParam({ requestId: "req-123" }, "request-id")).toBe("req-123");
  });
});

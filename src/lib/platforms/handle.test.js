import { describe, expect, it } from "vitest";
import { decodeHandle } from "./handle";

describe("decodeHandle", () => {
  it("decodes percent-encoding and lowercases", () => {
    expect(decodeHandle("%E6%96%B0%E5%93%81")).toBe("新品");
    expect(decodeHandle("Tees")).toBe("tees");
  });

  it("lowercases a malformed escape instead of throwing", () => {
    expect(decodeHandle("%E0%A4%A")).toBe("%e0%a4%a");
  });
});

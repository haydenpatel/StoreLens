import { describe, expect, it } from "vitest";
import { asText, asTexts } from "./coerce";

describe("asText", () => {
  it("keeps a string as it is", () => {
    expect(asText("Tee")).toBe("Tee");
    expect(asText("")).toBe("");
  });

  it("writes a finite number as text", () => {
    expect(asText(42)).toBe("42");
    expect(asText(0)).toBe("0");
  });

  it.each([[null], [undefined], [{}], [{ a: 1 }], [["a"]], [true], [NaN], [Infinity], [() => "x"]])(
    "turns %j into an empty string, never '[object Object]'",
    (value) => {
      expect(asText(value)).toBe("");
    }
  );
});

describe("asTexts", () => {
  it("keeps strings and numbers as text and drops everything else", () => {
    expect(asTexts(["a", 2, null, {}, "", ["x"], "b"])).toEqual(["a", "2", "b"]);
  });

  it.each([[undefined], [null], ["a,b"], [{ 0: "a" }], [5]])("treats %j as no list", (value) => {
    expect(asTexts(value)).toEqual([]);
  });
});

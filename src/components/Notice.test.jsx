import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Notice from "./Notice";

const html = (props) => renderToStaticMarkup(<Notice {...props}>Something happened</Notice>);

describe("Notice", () => {
  it("renders its message as an alert", () => {
    const out = html({ level: "info" });
    expect(out).toContain('role="alert"');
    expect(out).toContain("Something happened");
  });

  it("has no dismiss button unless onDismiss is given (errors are blocking)", () => {
    expect(html({ level: "error" })).not.toContain('aria-label="Dismiss"');
    expect(html({ level: "warning" })).not.toContain('aria-label="Dismiss"');
  });

  it("adds an accessible dismiss button, and room for it, when onDismiss is given", () => {
    for (const level of ["info", "warning"]) {
      const out = html({ level, onDismiss: () => {} });
      expect(out).toContain('aria-label="Dismiss"');
      expect(out).toContain('type="button"');
      expect(out).toContain("pr-10");
    }
  });

  it("styles each level differently", () => {
    const classOf = (level) => html({ level }).match(/class="([^"]*)"/)[1];
    expect(new Set([classOf("error"), classOf("warning"), classOf("info")]).size).toBe(3);
  });

  it("falls back to info for an unknown level", () => {
    expect(html({ level: "nope" })).toContain("Something happened");
  });
});

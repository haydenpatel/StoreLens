// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("./pages/StoreLens", () => ({
  default: () => {
    throw new Error("page exploded");
  },
}));

afterEach(cleanup);

describe("App (#185)", () => {
  it("shows the error message, not a blank page, when the page throws while rendering", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<App />);
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong/);
    vi.restoreAllMocks();
  });
});

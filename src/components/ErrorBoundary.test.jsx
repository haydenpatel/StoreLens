// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";

afterEach(cleanup);

function Boom() {
  throw new Error("render exploded");
}

beforeEach(() => {
  // React logs every caught render error; the boundary's own log is checked below.
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe("ErrorBoundary (#185)", () => {
  it("renders its children when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>all fine</p>
      </ErrorBoundary>
    );
    expect(screen.getByText("all fine")).toBeTruthy();
  });

  it("replaces a page that throws with a message instead of a blank page, and logs the error", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert").textContent).toMatch(/Something went wrong/);
    expect(screen.queryByText(/render exploded/)).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear saved data and reload" })).toBeTruthy();
    expect(console.error.mock.calls.some(([first]) => first instanceof Error && first.message === "render exploded")).toBe(true);
  });

  it("reloads from the Reload button without touching saved data", async () => {
    const reload = vi.fn();
    window.localStorage.setItem("storelens:collections:v3:shopify:https://a.example.com", "{}");
    render(
      <ErrorBoundary reload={reload}>
        <Boom />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("storelens:collections:v3:shopify:https://a.example.com")).toBe("{}");
  });

  it("clears the cached store data, then reloads, from the second button", async () => {
    const reload = vi.fn();
    window.localStorage.setItem("storelens:collections:v3:shopify:https://a.example.com", "{}");
    window.localStorage.setItem("storelens-url-history", "[]");
    render(
      <ErrorBoundary reload={reload}>
        <Boom />
      </ErrorBoundary>
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear saved data and reload" }));
    expect(window.localStorage.getItem("storelens:collections:v3:shopify:https://a.example.com")).toBeNull();
    expect(window.localStorage.getItem("storelens-url-history")).toBe("[]");
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

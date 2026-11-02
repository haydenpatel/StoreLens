// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LoadStatus from "./LoadStatus";

afterEach(cleanup);

describe("LoadStatus (#145)", () => {
  it("is a status region that stays mounted and empty while idle", () => {
    const { rerender } = render(<LoadStatus loading={false} loaded={0} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    rerender(<LoadStatus loading loaded={0} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Loading products…");
  });

  it("reports how many products have loaded", () => {
    render(<LoadStatus loading loaded={1250} />);
    expect(screen.getByRole("status").textContent).toBe("Loaded 1,250 products…");
  });

  it("clears when the load ends", () => {
    const { rerender } = render(<LoadStatus loading loaded={500} />);
    rerender(<LoadStatus loading={false} loaded={500} />);
    expect(screen.getByRole("status").textContent).toBe("");
  });
});

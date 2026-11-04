// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import LoadStatus from "./LoadStatus";

afterEach(cleanup);

describe("LoadStatus (#145)", () => {
  it("is a status region that stays mounted and empty until a load starts", () => {
    const { rerender } = render(<LoadStatus loading={false} count={0} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");
    rerender(<LoadStatus loading count={0} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Loading products");
  });

  it("does not announce each fetched page", () => {
    const { rerender } = render(<LoadStatus loading count={0} />);
    const status = screen.getByRole("status");
    for (const n of [250, 500, 750]) {
      rerender(<LoadStatus loading count={n} />);
      expect(status.textContent).toBe("Loading products");
    }
  });

  it("announces how many products loaded when the load ends", () => {
    const { rerender } = render(<LoadStatus loading count={0} />);
    rerender(<LoadStatus loading={false} count={1250} />);
    expect(screen.getByRole("status").textContent).toBe("Finished loading 1,250 products");
  });

  it("says the load stopped, not finished, when a cancel kept some products", () => {
    const { rerender } = render(<LoadStatus loading count={0} />);
    rerender(<LoadStatus loading={false} count={1250} cancelled />);
    expect(screen.getByRole("status").textContent).toBe("Loading stopped after 1,250 products");
  });

  it("says the load stopped when it ends with nothing loaded (cancel or error)", () => {
    const { rerender } = render(<LoadStatus loading count={0} />);
    rerender(<LoadStatus loading={false} count={0} />);
    expect(screen.getByRole("status").textContent).toBe("Loading stopped");
  });
});

import { describe, expect, it } from "vitest";
import { findMajorUpgrades, issueBody, rangeMajor, releasesUrl } from "./major-upgrades.mjs";

const pkg = {
  dependencies: { "lucide-react": "^0.554.0", react: "^19.2.0", "tailwind-merge": "^3.4.0" },
  devDependencies: {
    "@eslint/js": "^9.39.1",
    "@types/node": "^24.10.1",
    "@vitejs/plugin-react": "^5.1.0",
    eslint: "^9.39.1",
    vite: "^7.2.2",
  },
};

describe("rangeMajor", () => {
  it("reads the first number of a range", () => {
    expect(rangeMajor("^0.554.0")).toBe(0);
    expect(rangeMajor("~7.2.2")).toBe(7);
    expect(rangeMajor(">=9")).toBe(9);
    expect(rangeMajor("latest")).toBeNull();
  });
});

describe("findMajorUpgrades", () => {
  const outdated = {
    "lucide-react": { latest: "1.52.0" },
    react: { latest: "19.3.0" }, // minor only
    "tailwind-merge": { latest: "3.7.0" },
    "@eslint/js": { latest: "10.0.1" },
    eslint: { latest: "10.12.0" },
    "@types/node": { latest: "26.6.4" },
    "@vitejs/plugin-react": { latest: "6.1.1" },
    vite: { latest: "8.3.2" },
  };

  it("opens one issue per major, grouping packages that move together", () => {
    const found = findMajorUpgrades(pkg, outdated);
    expect(found.map((issue) => issue.title)).toEqual([
      "Upgrade vite to v8",
      "Upgrade eslint to v10",
      "Upgrade lucide-react to v1",
    ]);
    expect(found[0].upgrades.map((u) => u.name)).toEqual(["vite", "@vitejs/plugin-react"]);
    expect(found[1].upgrades.map((u) => u.name)).toEqual(["eslint", "@eslint/js"]);
  });

  it("never opens an issue for @types/node, minor-only or up-to-date packages", () => {
    const names = findMajorUpgrades(pkg, outdated).flatMap((i) => i.upgrades.map((u) => u.name));
    expect(names).not.toContain("@types/node");
    expect(names).not.toContain("react");
    expect(names).not.toContain("tailwind-merge");
  });

  it("titles a group after the first member that has a major upgrade", () => {
    const found = findMajorUpgrades(pkg, { "@vitejs/plugin-react": { latest: "6.1.1" } });
    expect(found).toEqual([
      {
        title: "Upgrade @vitejs/plugin-react to v6",
        upgrades: [{ name: "@vitejs/plugin-react", range: "^5.1.0", latest: "6.1.1" }],
      },
    ]);
  });

  it("returns nothing when nothing is outdated", () => {
    expect(findMajorUpgrades(pkg, {})).toEqual([]);
  });
});

describe("releasesUrl", () => {
  it("links GitHub repositories to their releases", () => {
    expect(releasesUrl("git+https://github.com/vitejs/vite.git", "vite")).toBe(
      "https://github.com/vitejs/vite/releases",
    );
    expect(releasesUrl("git@github.com:lucide-icons/lucide.git", "lucide-react")).toBe(
      "https://github.com/lucide-icons/lucide/releases",
    );
  });

  it("falls back to the npm page", () => {
    expect(releasesUrl("https://example.com/repo.git", "x")).toBe("https://www.npmjs.com/package/x");
    expect(releasesUrl(undefined, "x")).toBe("https://www.npmjs.com/package/x");
  });
});

describe("issueBody", () => {
  it("lists each package with its versions and link, and says when they move together", () => {
    const body = issueBody(
      [
        { name: "vite", range: "^7.2.2", latest: "8.3.2" },
        { name: "@vitejs/plugin-react", range: "^5.1.0", latest: "6.1.1" },
      ],
      { vite: "https://v", "@vitejs/plugin-react": "https://p" },
    );
    expect(body).toContain("- `vite`: `^7.2.2` → `8.3.2` ([release notes](https://v))");
    expect(body).toContain("`@vitejs/plugin-react`");
    expect(body).toContain("move together");
  });
});

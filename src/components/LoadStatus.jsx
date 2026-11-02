import React from "react";
import { formatCount } from "@/lib/locale";

// Screen-reader announcement of a collection load. It stays mounted (empty
// when idle) because a live region added to the page together with its text is
// often not announced; the visible spinner and count beside it are hidden from
// assistive tech so nothing is read twice.
export default function LoadStatus({ loading, loaded }) {
  return (
    <p role="status" className="sr-only">
      {loading
        ? loaded > 0
          ? `Loaded ${formatCount(loaded)} products…`
          : "Loading products…"
        : ""}
    </p>
  );
}

import React, { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/locale";

// outcome mirrors what the visible warning says: "finished" (clean end),
// "cancelled" (the user stopped it) or "incomplete" (a page error or the
// paging limit cut it short).
function endMessage(count, outcome) {
  if (count <= 0) return "Loading stopped";
  const n = formatCount(count);
  if (outcome === "cancelled") return `Loading stopped after ${n} products`;
  if (outcome === "incomplete") return `Loaded ${n} products; some could not be loaded`;
  return `Finished loading ${n} products`;
}

// Screen-reader announcement of a collection load: once when it starts and once
// when it ends (finished, stopped by the user, or cut short by an error or
// limit), never per fetched page, which would queue many polite announcements
// on a large collection. It stays mounted (empty until the first load) because
// a live region added to the page together with its text is often not
// announced. The visible spinner and running count are hidden from assistive
// tech (`aria-hidden`) so nothing is read twice.
export default function LoadStatus({ loading, count, outcome = "finished" }) {
  const [message, setMessage] = useState("");
  const wasLoading = useRef(false);

  useEffect(() => {
    if (loading && !wasLoading.current) {
      setMessage("Loading products");
    } else if (!loading && wasLoading.current) {
      setMessage(endMessage(count, outcome));
    }
    wasLoading.current = loading;
  }, [loading, count, outcome]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

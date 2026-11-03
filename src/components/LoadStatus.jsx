import React, { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/locale";

// Screen-reader announcement of a collection load: once when it starts and once
// when it ends (finished, stopped by the user, or failed), never per fetched page, which
// would queue many polite announcements on a large collection. It stays mounted
// (empty until the first load) because a live region added to the page together
// with its text is often not announced. The visible spinner and running count
// are hidden from assistive tech (`aria-hidden`) so nothing is read twice.
export default function LoadStatus({ loading, count, cancelled = false }) {
  const [message, setMessage] = useState("");
  const wasLoading = useRef(false);

  useEffect(() => {
    if (loading && !wasLoading.current) {
      setMessage("Loading products");
    } else if (!loading && wasLoading.current) {
      const n = formatCount(count);
      if (count <= 0) setMessage("Loading stopped");
      else setMessage(cancelled ? `Loading stopped after ${n} products` : `Finished loading ${n} products`);
    }
    wasLoading.current = loading;
  }, [loading, count, cancelled]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

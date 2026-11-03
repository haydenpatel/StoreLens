import React, { useEffect, useRef, useState } from "react";
import { formatCount } from "@/lib/locale";

// Screen-reader announcement of a collection load: once when it starts and once
// when it ends (finished, cancelled or failed), never per fetched page, which
// would queue many polite announcements on a large collection. It stays mounted
// (empty until the first load) because a live region added to the page together
// with its text is often not announced. The visible spinner and running count
// are hidden from assistive tech (`aria-hidden`) so nothing is read twice.
export default function LoadStatus({ loading, count }) {
  const [message, setMessage] = useState("");
  const wasLoading = useRef(false);

  useEffect(() => {
    if (loading && !wasLoading.current) {
      setMessage("Loading products");
    } else if (!loading && wasLoading.current) {
      setMessage(count > 0 ? `Finished loading ${formatCount(count)} products` : "Loading stopped");
    }
    wasLoading.current = loading;
  }, [loading, count]);

  return (
    <p role="status" className="sr-only">
      {message}
    </p>
  );
}

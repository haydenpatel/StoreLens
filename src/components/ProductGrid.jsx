import React, { useEffect, useId, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currencyLabel } from "@/lib/currency";
import { formatCount } from "@/lib/locale";
import ProductCard from "./ProductCard";

// Rendering a DOM card per product doesn't scale to collections with
// thousands of items, so only a growing chunk is mounted at a time; a
// sentinel below the grid reveals more as the user scrolls near it.
const CHUNK_SIZE = 60;

function ProductGrid({ products, totalProducts, sortBy, setSortBy, currency }) {
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const [productsForReset, setProductsForReset] = useState(products);
  const sortLabelId = useId();
  const sentinelRef = useRef(null);

  // A new search/filter/sort produces a new products array — start over
  // from the top of it rather than keeping whatever was already revealed.
  // Adjusted during render (React's recommended pattern for resetting state
  // on a prop change) rather than in an effect, to avoid an extra render pass.
  if (products !== productsForReset) {
    setProductsForReset(products);
    setVisibleCount(CHUNK_SIZE);
  }

  // The observer only reports when the sentinel's intersecting state changes,
  // so a sentinel that stays in view (after a filter shrinks the list, or
  // after a chunk that didn't push it out of range) would never reveal more.
  // Re-observing whenever the list or the revealed count changes makes it
  // report the current state again, so reveals continue until the sentinel
  // leaves view or the list is exhausted. This also reattaches to the
  // sentinel node, which remounts when a filter empties the results.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, products.length));
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [products, visibleCount]);

  const visibleProducts = products.slice(0, visibleCount);
  // The same id can appear twice (a product repeated across pages); only the
  // repeats get a suffix, so a normal card keeps a stable key across re-sorts.
  const seenIds = new Map();
  const cardKeys = visibleProducts.map((product) => {
    const n = seenIds.get(product.id) ?? 0;
    seenIds.set(product.id, n + 1);
    return n === 0 ? String(product.id) : `${product.id}-dup${n}`;
  });
  const hasMoreToShow = visibleCount < products.length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div role="status" className="text-sm text-foreground">
          Showing <span className="font-bold">{formatCount(products.length)}</span> of{" "}
          <span className="font-bold">{formatCount(totalProducts)}</span> products
        </div>

        <div className="flex items-center gap-2">
          <span id={sortLabelId} className="text-sm text-foreground">Sort by:</span>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger aria-labelledby={sortLabelId} className="w-44 sm:w-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title-asc">Title A-Z</SelectItem>
              <SelectItem value="title-desc">Title Z-A</SelectItem>
              <SelectItem value="price-asc">Price: Low to High</SelectItem>
              <SelectItem value="price-desc">Price: High to Low</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="discount-percent">Discount %: High to Low</SelectItem>
              <SelectItem value="discount-amount">Discount {currencyLabel(currency)}: High to Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Product Grid */}
      {products.length > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {visibleProducts.map((product, i) => (
              <ProductCard key={cardKeys[i]} product={product} />
            ))}
          </div>
          <div ref={sentinelRef} aria-hidden="true" className="h-px" />
          {hasMoreToShow && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}
        </>
      ) : (
        <div className="text-center py-20">
          <p className="text-muted-foreground">No products match your filters</p>
        </div>
      )}
    </div>
  );
}

// Unrelated parent state (like the store URL input) shouldn't force every
// product card to re-render — this can be a large list.
export default React.memo(ProductGrid);

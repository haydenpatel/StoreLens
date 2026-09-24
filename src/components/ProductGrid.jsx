import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ProductCard from "./ProductCard";

// Rendering a DOM card per product doesn't scale to collections with
// thousands of items, so only a growing chunk is mounted at a time; a
// sentinel below the grid reveals more as the user scrolls near it.
const CHUNK_SIZE = 60;

function ProductGrid({ products, totalProducts, sortBy, setSortBy, collectionUrl }) {
  const [visibleCount, setVisibleCount] = useState(CHUNK_SIZE);
  const [productsForReset, setProductsForReset] = useState(products);
  const sentinelRef = useRef(null);
  const productsLengthRef = useRef(products.length);

  useEffect(() => {
    productsLengthRef.current = products.length;
  });

  // A new search/filter/sort produces a new products array — start over
  // from the top of it rather than keeping whatever was already revealed.
  // Adjusted during render (React's recommended pattern for resetting state
  // on a prop change) rather than in an effect, to avoid an extra render pass.
  if (products !== productsForReset) {
    setProductsForReset(products);
    setVisibleCount(CHUNK_SIZE);
  }

  // The sentinel div only exists while there are any (filtered) products at
  // all — it unmounts when a filter empties the results and remounts when
  // results reappear. Re-run setup on that transition (not on every list
  // change) so the observer reattaches to the new node; productsLengthRef
  // keeps the growth cap current without needing the effect to rerun too.
  const hasProducts = products.length > 0;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, productsLengthRef.current));
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasProducts]);

  const visibleProducts = products.slice(0, visibleCount);
  const hasMoreToShow = visibleCount < products.length;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
        <div className="text-sm text-foreground">
          Showing <span className="font-bold">{products.length}</span> of{" "}
          <span className="font-bold">{totalProducts}</span> products
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-foreground">Sort by:</span>
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-44 sm:w-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title-asc">Title A-Z</SelectItem>
              <SelectItem value="title-desc">Title Z-A</SelectItem>
              <SelectItem value="price-asc">Price: Low to High</SelectItem>
              <SelectItem value="price-desc">Price: High to Low</SelectItem>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="discount-percent">Discount %: High to Low</SelectItem>
              <SelectItem value="discount-amount">Discount $: High to Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Product Grid */}
      {products.length > 0 ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
            {visibleProducts.map(product => (
              <ProductCard key={product.id} product={product} collectionUrl={collectionUrl} />
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

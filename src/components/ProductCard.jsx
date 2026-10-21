import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Package } from "lucide-react";
import { getDiscountData, shownVariants } from "@/lib/utils";
import { formatMoneyRange } from "@/lib/currency";

function ProductCard({ product }) {
  const image = product.images?.[0]?.url || null;
  // While filters narrow a product's variants, the price, badge and stock
  // label describe the matching ones; the variant list below stays complete.
  const variants = shownVariants(product);
  const prices = variants.map(v => v.price).filter(p => !Number.isNaN(p));
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const inStock = variants.some(v => v.available);
  const maxTagsToShow = 3;
  const maxTagChars = 18; // only show tags shorter than or equal to this
  const maxTagDisplayChars = 16; // truncate displayed tag text to this length

  // Core discount data using shared helper
  const { hasDiscount, discountAmount, discountPercent, minAmount, minPercent, bestPercentAmount } = getDiscountData(variants);
  const percentLabel = (n) => (n >= 1 ? n.toFixed(0) : n.toFixed(1));
  // One figure when the discounted variants agree, otherwise a range of both
  // the saving and the percentage (never an amount and a percentage from
  // different variants).
  const lowPct = percentLabel(minPercent ?? 0);
  const highPct = percentLabel(discountPercent);
  const isRange = hasDiscount && (lowPct !== highPct || minAmount !== discountAmount);
  const pctRange = lowPct === highPct ? highPct : `${lowPct}-${highPct}`;
  const upTo = `Save up to ${formatMoneyRange(bestPercentAmount ?? 0, bestPercentAmount ?? 0, product.currency)} (${highPct}% off)`;
  // The badge is too narrow for a range on a phone, so there it falls back to
  // "up to" the best-percentage variant's own saving.
  const discountText = !hasDiscount
    ? null
    : !isRange
      ? `Save ${formatMoneyRange(discountAmount, discountAmount, product.currency)} (${highPct}% off)`
      : (
        <>
          <span className="hidden sm:inline">
            {`Save ${formatMoneyRange(minAmount, discountAmount, product.currency)} (${pctRange}% off)`}
          </span>
          <span className="sm:hidden">{upTo}</span>
        </>
      );

  // Prepare variant titles for display (display up to maxChars and use `+N more`)
  const variantTitles = (product.variants || []).map(v => v.title || '').filter(Boolean);
  const maxChars = 35; // max characters to show for the combined titles
  let variantsDisplay = '';
  let remaining = 0;
  if (variantTitles.length > 0) {
    let cur = '';
    let used = 0;
    for (let i = 0; i < variantTitles.length; i++) {
      const title = variantTitles[i];
      const sep = cur.length ? ', ' : '';
      if ((cur + sep + title).length <= maxChars) {
        cur = cur + sep + title;
        used++;
      } else {
        // If nothing has been added yet, truncate the first title to fit
        if (!cur.length) {
          const fit = Math.max(0, maxChars - 3);
          cur = title.slice(0, fit) + (title.length > fit ? '...' : '');
          used++;
        }
        break;
      }
    }
    variantsDisplay = cur;
    remaining = variantTitles.length - used;
  }

  // Absolute product link, built by the platform adapter
  const productUrl = product.url || null;

  const priceDisplay = minPrice === null
    ? "Price unavailable"
    : formatMoneyRange(minPrice, maxPrice, product.currency);

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 border-border py-0">
      <CardContent className="p-0">
        {/* Image */}
        <div className="aspect-square overflow-hidden rounded-t-xl relative">
          {image ? (
            <img
              src={image}
              alt={product.title}
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="w-12 h-12 text-muted" />
            </div>
          )}
          
          {/* Stock badge */}
          {!inStock && (
            <Badge variant="secondary" className="absolute top-0 right-2 bg-destructive text-primary-foreground text-[10px] px-1.5 sm:text-xs sm:px-2">
              Out of Stock
            </Badge>
          )}

          {hasDiscount && inStock && (
            <Badge variant="secondary" className="absolute top-0 right-2 bg-chart-3 text-primary-foreground text-[10px] px-1.5 sm:text-xs sm:px-2">
              {discountText}
            </Badge>
          )}

          {hasDiscount && !inStock && (
            <Badge variant="secondary" className="absolute top-6 right-2 bg-chart-3 text-primary-foreground text-[10px] px-1.5 sm:text-xs sm:px-2">
              {discountText}
            </Badge>
          )}
        </div>

        {/* Content */}
        <div className="p-3 sm:p-4 space-y-2">
          {/* Title */}
          <h3 className="font-medium text-foreground line-clamp-2 min-h-[3rem]">
            {product.title}
          </h3>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between pt-2">
            {/* Price */}
            <div>
              <p className="font-semibold">{priceDisplay}</p>
              {/* Variants*/}
              <p className="text-xs text-muted-foreground">
              {variantsDisplay}
              <i>{(remaining > 0 ? ` +${remaining} more` : '')}</i>
              </p>
            </div>

            {/* View button */}
            {productUrl && (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="gap-1 self-start"
              >
                <a 
                  href={productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-3 h-3" />
                  View
                </a>
              </Button>
            )}
          </div>

          {/* Vendor */}
          {product.vendors?.length > 0 && (
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {product.vendors.join(", ")}
            </p>
          )}

          {/* Tags */}
          {Array.isArray(product.tags) && product.tags.length > 0 && (() => {
            // A feed can carry a non-string (null) tag; skip those so one bad
            // entry can't crash the grid.
            const tags = product.tags.filter(t => typeof t === 'string');
            const shortTags = tags.filter(t => t.length <= maxTagChars);
            const useTags = shortTags.length > 0
              ? shortTags.slice(0, maxTagsToShow)
              : tags.slice(0, maxTagsToShow); // fallback to first tags if none are short

            const displayedCount = useTags.length;
            const hiddenCount = tags.length - displayedCount;

            return (
              <div className="flex flex-wrap gap-1">
                {useTags.map((tag, i) => (
                  <Badge key={`${i}-${tag}`} variant="tags">
                    {tag.length > maxTagDisplayChars ? tag.slice(0, maxTagDisplayChars - 1) + '…' : tag}
                  </Badge>
                ))}
                {hiddenCount > 0 && (
                  <Badge variant="tags">+{hiddenCount}</Badge>
                )}
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}

export default React.memo(ProductCard);

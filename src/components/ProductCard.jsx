import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Package } from "lucide-react";
import { getDiscountData } from "@/lib/utils";

function ProductCard({ product, collectionUrl }) {
  const image = product.images?.[0]?.src || null;
  const variants = product.variants || [];
  const prices = variants.map(v => parseFloat(v.price)).filter(p => !Number.isNaN(p));
  const minPrice = prices.length > 0 ? Math.min(...prices) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : null;
  const inStock = variants.some(v => v.available);
  const maxTagsToShow = 3;
  const maxTagChars = 18; // only show tags shorter than or equal to this
  const maxTagDisplayChars = 16; // truncate displayed tag text to this length

  // Core discount data using shared helper
  const { hasDiscount, discountAmount, discountPercent } = getDiscountData(variants);

  // Prepare variant titles for display (display up to maxChars and use `+N more`)
  const variantTitles = (variants || []).map(v => v.title || v.name || '').filter(Boolean);
  const maxChars = 35; // max characters to show for the combined titles
  let variantsDisplay = '';
  let remaining = 0;
  if (variantTitles.length > 0) {
    let cur = '';
    let used = 0;
    for (let i = 0; i < variantTitles.length; i++) {
      if (variantTitles[i] === 'Default Title') { // LTTStore.com - skip 'Default Title'
        used++;
        continue;
      } else {
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
    }
    variantsDisplay = cur;
    remaining = variantTitles.length - used;
  }

  // Get product URL from handle
  const productUrl = product.handle && collectionUrl
    ? `https://${collectionUrl}/products/${product.handle}`
    : null;

  const priceDisplay = minPrice === null
    ? "Price unavailable"
    : minPrice === maxPrice
    ? `$${minPrice.toFixed(2)}`
    : `$${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}`;

  return (
    <Card className="group hover:shadow-lg transition-all duration-200 border-border">
      <CardContent className="p-0">
        {/* Image */}
        <div className="aspect-square overflow-hidden rounded-t-lg relative">
          {image ? (
            <img 
              src={image} 
              alt={product.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="w-12 h-12 text-muted" />
            </div>
          )}
          
          {/* Stock badge */}
          {!inStock && (
            <Badge variant="secondary" className="absolute top-0 right-2 bg-destructive text-primary-foreground">
              Out of Stock
            </Badge>
          )}
          
          {hasDiscount && inStock && (
            <Badge variant="secondary" className="absolute top-0 right-2 bg-chart-3 text-primary-foreground">
              Save ${discountAmount.toFixed(2)}{" "}
              {discountPercent >= 1
                ? `(${discountPercent.toFixed(0)}% off)`
                : `(${discountPercent.toFixed(1)}% off)`}   {/* show tiny discounts too */}
            </Badge>
          )}
          
          {hasDiscount && !inStock && (
            <Badge variant="secondary" className="absolute top-6 right-2 bg-chart-3 text-primary-foreground">
              Save ${discountAmount.toFixed(2)}{" "}
              {discountPercent >= 1
                ? `(${discountPercent.toFixed(0)}% off)`
                : `(${discountPercent.toFixed(1)}% off)`}   {/* show tiny discounts too */}
            </Badge>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-2">
          {/* Title */}
          <h3 className="font-medium text-foreground line-clamp-2 min-h-[3rem]">
            {product.title}
          </h3>

          <div className="flex items-top justify-between pt-2 min-h-[3rem]">
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
                className="gap-1"
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
          {product.vendor && (
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              {product.vendor}
            </p>
          )}

          {/* Tags */}
          {product.tags && product.tags.length > 0 && (() => {
            const shortTags = product.tags.filter(t => (t || '').length <= maxTagChars);
            const useTags = shortTags.length > 0
              ? shortTags.slice(0, maxTagsToShow)
              : product.tags.slice(0, maxTagsToShow).map(t => t); // fallback to first tags if none are short

            const displayedCount = useTags.length;
            const hiddenCount = product.tags.length - displayedCount;

            return (
              <div className="flex flex-wrap gap-1">
                {useTags.map(tag => (
                  <Badge key={tag} variant="tags">
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

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLink, Package } from "lucide-react";
import { getDiscountData } from "@/lib/utils";

export default function ProductCard({ product, collectionUrl }) {
  const image = product.images?.[0]?.src || null;
  const variants = product.variants || [];
  const prices = variants.map(v => parseFloat(v.price));
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  // const hasDiscount = variants.some(v => v.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price));
  const inStock = variants.some(v => v.available);

  // Find all discounted variants
  const discountedVariants = variants.filter(v =>
    v.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price)
  );

  // Core discount data using shared helper
const { hasDiscount, discountAmount, discountPercent } =
  getDiscountData(variants);

  // if (hasDiscount) {
  //   // Use variant with the largest absolute $ discount
  //   const best = discountedVariants.reduce((best, v) => {
  //     const price = parseFloat(v.price);
  //     const compare = parseFloat(v.compare_at_price);
  //     const diff = compare - price;

  //     return diff > best.amount
  //       ? { amount: diff, price, compare }
  //       : best;
  //   }, { amount: 0, price: 0, compare: 0 });

  //   discountAmount = best.amount;
  //   discountPercent = (discountAmount / best.compare) * 100; // e.g. 0.4, 12.3, etc.
  // }

  // Get product URL from handle
  const productUrl = product.handle ? 
    // `https://${new URL(product.images?.[0]?.src || '').hostname}/products/${product.handle}` :
    `https://${collectionUrl}/products/${product.handle}` :
    null;

  const priceDisplay = minPrice === maxPrice 
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
          <h3 className="font-medium text-foreground line-clamp-2 min-h-[2.5rem]">
            {product.title}
          </h3>

          <div className="flex items-center justify-between pt-2">
            {/* Price */}
            <div>
              <p className="font-semibold">{priceDisplay}</p>
              {/* Variants*/}
              <p className="text-xs text-muted-foreground">
              {variants.length > 1 
                ? `${variants.length} variants`
                : <span>&nbsp;</span>
              }</p>
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
          {product.tags && product.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {product.tags.slice(0, 2).map(tag => (
                <Badge 
                  key={tag} 
                  variant="tags" 
                >
                  {tag}
                </Badge>
              ))}
              {product.tags.length > 2 && (
                <Badge 
                  variant="tags" 
                >
                  +{product.tags.length - 2}
                </Badge>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Discount over the variants a shopper can buy: in-stock ones when any exist,
// otherwise all (an all-sold-out product keeps its badge). discountAmount and
// discountPercent are the biggest saving and the best percentage, each taken
// across variants (they feed the sorts); the min/max fields describe the spread
// for the badge, and bestPercentAmount is the saving of the best-percentage
// variant, so a "up to" badge never pairs figures from different variants.
export function getDiscountData(variants = []) {
  const pool = variants.some(v => v.available) ? variants.filter(v => v.available) : variants;
  const discounts = pool
    .filter(v => v.compareAtPrice && v.compareAtPrice > v.price)
    .map(v => {
      const amount = v.compareAtPrice - v.price;
      return { amount, percent: (amount / v.compareAtPrice) * 100 };
    });

  if (discounts.length === 0) {
    return { hasDiscount: false, discountAmount: 0, discountPercent: 0 };
  }

  const amounts = discounts.map(d => d.amount);
  const percents = discounts.map(d => d.percent);
  const discountPercent = Math.max(...percents);
  return {
    hasDiscount: true,
    discountAmount: Math.max(...amounts),
    discountPercent,
    minAmount: Math.min(...amounts),
    minPercent: Math.min(...percents),
    bestPercentAmount: discounts.find(d => d.percent === discountPercent).amount,
  };
}

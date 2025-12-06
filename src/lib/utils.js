import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function getDiscountData(variants = []) {
  const discountedVariants = variants.filter(v =>
    v.compare_at_price && parseFloat(v.compare_at_price) > parseFloat(v.price)
  );

  const hasDiscount = discountedVariants.length > 0;
  let discountAmount = 0;
  let discountPercent = 0;

  if (hasDiscount) {
    const best = discountedVariants.reduce((best, v) => {
      const price = parseFloat(v.price);
      const compare = parseFloat(v.compare_at_price);
      const diff = compare - price;

      return diff > best.amount
        ? { amount: diff, price, compare }
        : best;
    }, { amount: 0, price: 0, compare: 0 });

    discountAmount = best.amount;
    discountPercent = (discountAmount / best.compare) * 100;
  }

  return { hasDiscount, discountAmount, discountPercent };
}

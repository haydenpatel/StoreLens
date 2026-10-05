// Synthetic Fourthwall-shaped products for offline tests. See README.md.
// Everything is invented (example.com images, made-up products); the shapes
// follow the public {origin}/collections/{slug}/{n}.json feed.

let nextId = 1;

export function variant(title, { cents = 2000, currency = "USD" } = {}) {
  return { id: `variant-${nextId++}`, title, price: { cents, currency_iso: currency } };
}

export function product(overrides = {}) {
  const id = nextId++;
  const handle = overrides.handle ?? `product-${id}`;
  return {
    id: `product-${id}`,
    title: `Product ${id}`,
    handle,
    image: "https://example.com/img.webp",
    url: `/products/${handle}`,
    available: true,
    compare_at_price: null,
    price: "20.00",
    variants: [variant("S"), variant("M"), variant("L")],
    created_at: "2026-09-28 18:59:56 UTC",
    updated_at: "2026-10-02 22:00:00 UTC",
    ...overrides,
  };
}

// One page of a collection, as the feed returns it.
export function collectionPage(products, { page = 1, handle = "all", title = "All Products" } = {}) {
  return { id: `collection-${handle}`, handle, title, products, current_page: page };
}

// A small catalog covering what the adapter has to handle.
export function catalog() {
  return [
    // Two option groups: a colour and a size.
    product({
      title: "Example Tee",
      handle: "example-tee",
      variants: ["Black, XS", "Black, S", "Black, M", "Vintage Black, XS", "Vintage Black, S", "Vintage Black, M"].map((title) =>
        variant(title)
      ),
    }),
    // A bigger size costs more, and the compare-at price makes it a sale.
    product({
      title: "Example Hoodie",
      handle: "example-hoodie",
      price: "40.00",
      compare_at_price: "55.00",
      variants: [variant("M", { cents: 4000 }), variant("L", { cents: 4000 }), variant("2XL", { cents: 4400 })],
    }),
    // Sold out.
    product({ title: "Example Cap", handle: "example-cap", available: false, variants: [variant("One Size")] }),
    // No real options.
    product({ title: "Example Sticker", handle: "example-sticker", price: "5.00", variants: [variant("Default", { cents: 500 })] }),
    // Not a size: a colour only.
    product({ title: "Example Mug", handle: "example-mug", variants: [variant("White"), variant("Blue")] }),
  ];
}

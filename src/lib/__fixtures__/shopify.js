// Synthetic Shopify-shaped products for offline tests. See README.md.

let nextId = 1;

export function variant(overrides = {}) {
  const id = nextId++;
  return {
    id,
    title: "Default Title",
    price: "10.00",
    compare_at_price: null,
    available: true,
    option1: null,
    option2: null,
    option3: null,
    ...overrides,
  };
}

export function product(overrides = {}) {
  const id = nextId++;
  return {
    id,
    title: `Product ${id}`,
    handle: `product-${id}`,
    body_html: "",
    vendor: "",
    product_type: "",
    tags: [],
    created_at: "2026-01-01T00:00:00-00:00",
    images: [{ src: "https://example.com/img.jpg" }],
    options: [{ name: "Title", position: 1, values: ["Default Title"] }],
    variants: [variant()],
    ...overrides,
  };
}

// A small catalog covering every filter and sort the UI offers.
export function catalog() {
  return [
    product({
      title: "Acme Blue Tee",
      handle: "acme-blue-tee",
      body_html: "<p>Soft cotton shirt</p>",
      vendor: "Acme",
      product_type: "Shirts",
      tags: ["summer", "cotton"],
      created_at: "2026-03-01T00:00:00-00:00",
      options: [{ name: "Size" }, { name: "Color" }],
      variants: [
        variant({ price: "20.00", option1: "S", option2: "Blue" }),
        variant({ price: "22.00", option1: "M", option2: "Blue", available: false }),
      ],
    }),
    product({
      title: "Beta Red Hoodie",
      handle: "beta-red-hoodie",
      body_html: "<p>Warm hoodie</p>",
      vendor: "Beta Co",
      product_type: "Hoodies",
      tags: ["winter"],
      created_at: "2026-02-01T00:00:00-00:00",
      options: [{ name: "Size" }],
      variants: [
        variant({ price: "50.00", compare_at_price: "80.00", option1: "L" }),
      ],
    }),
    product({
      title: "Cedar Mug",
      handle: "cedar-mug",
      vendor: "Acme",
      product_type: "Mugs",
      tags: ["cotton", "gift"],
      created_at: "2026-04-01T00:00:00-00:00",
      variants: [
        variant({ price: "12.50", compare_at_price: "15.00", available: false }),
      ],
    }),
    product({
      title: "Delta Cap",
      handle: "delta-cap",
      vendor: "",
      product_type: "",
      tags: [],
      created_at: "2025-12-01T00:00:00-00:00",
      variants: [variant({ price: "5.00", available: false })],
    }),
  ];
}

// "Size" sits at option1 on some products, option2 on others and option3 on
// others, and the first option also holds other names such as Color. There is
// a "Title"/"Default Title" placeholder product, a differently cased "SIZE",
// and a distinct "Waist size". Mirrors a structure seen on real Shopify
// stores; the products themselves are invented.
export function scatteredOptionsCatalog() {
  return [
    product({
      title: "Cap",
      options: [{ name: "Color" }, { name: "Length" }],
      variants: [variant({ option1: "Black", option2: "Short" })],
    }),
    product({
      title: "Shirt",
      options: [{ name: "Size" }, { name: "Color" }],
      variants: [
        variant({ option1: "Small", option2: "Black" }),
        variant({ option1: "Large", option2: "Black" }),
      ],
    }),
    product({
      title: "Jacket",
      options: [{ name: "Color" }, { name: "Length" }, { name: "Size" }],
      variants: [variant({ option1: "Olive", option2: "Regular", option3: "Large" })],
    }),
    product({
      title: "Trousers",
      options: [{ name: "Color" }, { name: "Waist size" }],
      variants: [
        variant({ option1: "Navy", option2: "32" }),
        variant({ option1: "Navy", option2: "34" }),
      ],
    }),
    product({
      title: "Hat",
      options: [{ name: "SIZE" }],
      variants: [variant({ option1: "X-Small" })],
    }),
    product({
      title: "Poster",
      options: [{ name: "Title", values: ["Default Title"] }],
      variants: [variant({ title: "Default Title", option1: "Default Title" })],
    }),
  ];
}

export function collectionsPage(handles) {
  return {
    collections: handles.map(([handle, title, products_count]) => ({
      handle,
      title,
      products_count,
    })),
  };
}

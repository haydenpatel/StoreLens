// Synthetic Big Cartel-shaped products for offline tests. See README.md.
// Everything is invented (example.com images, made-up products); the shapes
// follow the public api.bigcartel.com/{shop}/products.json feed.

let nextId = 1;

export function category(name, permalink = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")) {
  return { id: nextId++, name, permalink, url: `/category/${permalink}` };
}

// A value in one option group, as the group lists it.
export function groupValue(group, name) {
  return { id: nextId++, name, option_group_id: group.id };
}

export function optionGroup(name, valueNames, position = 1) {
  const group = { id: nextId++, name, position, values: [] };
  group.values = valueNames.map((valueName, i) => ({ ...groupValue(group, valueName), position: i + 1 }));
  return group;
}

// An option (what a buyer picks) made of one value from each group.
export function option(name, { price = 20, soldOut = false, values = [] } = {}) {
  return { id: nextId++, name, price, sold_out: soldOut, has_custom_price: false, option_group_values: values };
}

export function product(overrides = {}) {
  const id = nextId++;
  const permalink = overrides.permalink ?? `product-${id}`;
  return {
    id,
    name: `Product ${id}`,
    permalink,
    position: id,
    price: 20,
    default_price: 20,
    tax: 0,
    on_sale: false,
    url: `/product/${permalink}`,
    status: "active",
    created_at: "2026-09-28T18:59:56.000+02:00",
    description: "<p>An invented product.</p>",
    has_option_groups: false,
    has_password_protection: false,
    options: [option("Default")],
    option_groups: [],
    images: [{ url: "https://example.com/img.png", secure_url: "https://example.com/img.png", width: 800, height: 800 }],
    artists: [],
    categories: [],
    ...overrides,
  };
}

// A product sold in sizes: one option group, one option per size.
export function sized(overrides = {}, sizes = ["S", "M", "L"], { price = 20, soldOut = [] } = {}) {
  const group = optionGroup("Size", sizes);
  return product({
    has_option_groups: true,
    option_groups: [group],
    options: sizes.map((size, i) => option(size, { price, soldOut: soldOut.includes(size), values: [group.values[i]] })),
    ...overrides,
  });
}

// A small catalog covering what the adapter has to handle.
export function catalog() {
  const tees = category("Tees");
  const prints = category("Art Prints", "art-prints");
  const colour = optionGroup("Colour", ["Black", "White"], 2);
  const size = optionGroup("Size", ["S", "M"], 1);
  return [
    // Two option groups, listed in the opposite order to their positions.
    product({
      name: "Example Tee",
      permalink: "example-tee",
      categories: [tees],
      artists: [{ id: nextId++, name: "Example Artist" }],
      has_option_groups: true,
      option_groups: [colour, size],
      options: colour.values.flatMap((c) =>
        size.values.map((s) => option(`${c.name} / ${s.name}`, { values: [s, c] }))
      ),
    }),
    // Cheaper than its base price while on sale.
    sized({ name: "Example Hoodie", permalink: "example-hoodie", categories: [tees], on_sale: true, default_price: 55, price: 40 }, ["M", "L"], { price: 40 }),
    // Sold out, in two categories.
    product({ name: "Example Print", permalink: "example-print", status: "sold-out", categories: [prints, tees], options: [option("Default", { soldOut: true })] }),
    // No options and no category.
    product({ name: "Example Sticker", permalink: "example-sticker", price: 5, default_price: 5, options: [option("Default", { price: 5 })] }),
  ];
}

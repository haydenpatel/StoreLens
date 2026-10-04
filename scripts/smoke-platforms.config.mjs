// Sample stores for scripts/smoke-platforms.mjs. Domains and handles only;
// never put store content here. Stores come and go, so the script reports
// vanished ones as "gone" rather than failing; refresh the lists when it does.

export const PLATFORMS = [
  {
    id: "shopify",
    name: "Shopify",
    // A few stores of varied size. `collection` is checked page by page.
    stores: [
      { host: "www.allbirds.com", collection: "all" }, // ~700 products, several 250-item pages
      { host: "www.taylorstitch.com", collection: "all" },
      { host: "global.lttstore.com", collection: "all" },
      { host: "www.glossier.com", collection: "all" },
    ],
  },
  {
    id: "fourthwall",
    name: "Fourthwall",
    stores: [
      { host: "merch.unraid.net" },
      { host: "shop.nymag.com" },
      { host: "snazzyseagullshop.com" },
      { host: "mkbhd.com" },
    ],
  },
  {
    id: "bigcartel",
    name: "Big Cartel",
    // Shop subdomain names, read from api.bigcartel.com/{shop}/products.json.
    stores: [
      { shop: "josearoda" },
      { shop: "fellowhumans" },
      { shop: "conanusamerch" },
    ],
  },
];

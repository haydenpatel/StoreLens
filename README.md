# StoreLens

[![Vite](https://img.shields.io/badge/Vite-646CFF.svg?style=flat&logo=vite&logoColor=white)](https://vitejs.dev/)
[![React](https://img.shields.io/badge/React-087ea4.svg?style=flat&logo=react&logoColor=white)](https://react.dev/)
[![shadcn/ui](https://img.shields.io/badge/shadcn%2Fui-161618.svg?style=flat&logo=shadcnui&logoColor=white)](https://ui.shadcn.com/)
[![Cloudflare Pages](https://img.shields.io/badge/Cloudflare_Pages-F38020.svg?style=flat&logo=cloudflare&logoColor=white)](https://pages.cloudflare.com/)
<!-- [![TailwindCSS](https://img.shields.io/badge/TailwindCSS-06B6D4.svg?style=flat&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Radix UI](https://img.shields.io/badge/Radix_UI-161618.svg?style=flat&logo=radixui&logoColor=white)](https://www.radix-ui.com/) -->

![StoreLens icon](public/apple-touch-icon.png)

When a store doesn't offer decent filtering, sorting, or search, browsing becomes a chore. **StoreLens** gives you a cleaner, more powerful view of an online store's catalogue.

Just paste a store's domain or collection URL (see [Supported platforms](#supported-platforms)) and StoreLens loads the full product list, complete with filtering, sorting, and search — all client-side, with no backend or API keys required.

*Live demo coming soon.*
<!-- See it in action at [storelens.ctrlalt.nz](https://storelens.ctrlalt.nz) -->


## Supported platforms

StoreLens only works with platforms that publish a keyless, browser-readable product listing, so it needs no backend, proxy or API keys.

| Platform | Status |
|---|---|
| Shopify | Supported |
| Fourthwall | Planned |
| Big Cartel | Planned |

Each platform is a small adapter (`src/lib/platforms/`) that turns the platform's own listing into one neutral product shape, so the filters, sorting and search are shared. Platforms that don't allow cross-origin reads (WooCommerce, Magento, Squarespace) or need per-merchant tokens (BigCommerce, Salesforce Commerce Cloud) can't work without a backend and are out of scope.


## Features

- Browse any collection (including all products)
- Auto-detect default collections from bare domains  
- Loads full pagination for complete product retrieval  
- Filter by vendor, category, tags, variant options, price, and stock or sale status — even if the shop doesn’t show them  
- Sorting by title, price, newest first, or highest discount 
- Search across product titles and descriptions  
- URL history to quickly re-visit recent stores
- Clean UI built with Tailwind + shadcn/ui  
- 100% client-side — no API keys or server required
- Deploy-ready for Cloudflare Pages, GitHub Pages, Netlify, Vercel, or any other static file host!


## Tech Stack

- React (Vite)
- Tailwind CSS v4
- shadcn/ui + Radix UI
- JavaScript
- lucide-react icons

## Development

Assuming your environment is already configured:

```bash
npm install
npm run dev
```

Run the tests with `npm test` (they run offline against synthetic fixtures, never real store data) and lint with `npm run lint`.

## Status and Limitations

StoreLens is currently in ***early alpha*** (0.1).

Core browsing, filtering, and sorting features are functional, with a small number of enhancements planned.

StoreLens relies on each platform’s public JSON endpoints. Stores that restrict or heavily customise their storefront data may return incomplete or inconsistent information.

**A note about very large collections:** StoreLens works by fetching every product in a collection. Extremely large catalogues may load slowly, and performance will depend on your browser and computer.

## Known Issues

### Shopify

- Shopify enforces a limit of 1,000 collection pages (and 250 products per page).
  Collections larger than 250,000 items cannot be fully loaded and will cause StoreLens to crash.


## License

MIT
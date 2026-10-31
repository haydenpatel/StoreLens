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

**Try it:** [storelens.pages.dev](https://storelens.pages.dev)


## Supported platforms

StoreLens only works with platforms that publish a keyless, browser-readable product listing, so it needs no backend, proxy or API keys.

| Platform | Status |
|---|---|
| Shopify | Supported |
| Fourthwall | Supported |
| Big Cartel | Supported (`*.bigcartel.com` shops) |

Each platform is a small adapter (`src/lib/platforms/`) that turns the platform's own listing into one neutral product shape, so the filters, sorting and search are shared. Platforms that don't allow cross-origin reads (WooCommerce, Magento, Squarespace) or need per-merchant tokens (BigCommerce, Salesforce Commerce Cloud) can't work without a backend and are out of scope.


## Features

- Browse any collection (including all products)
- Auto-detect default collections from bare domains  
- Loads full pagination for complete product retrieval  
- Filter by vendor, category, tags, variant options, price, and stock or sale status — even if the shop doesn’t show them. Filters match per variant: one variant must meet the selected options, stock, price and sale filters together  
- Sorting by title, price, newest first, or highest discount 
- Search across product titles and descriptions  
- Numbers, sorting and search follow your browser's language: digit layout (separators, grouping, percentages, counts) and sort order match your locale, and search ignores case and accents ("cafe" finds "Café"), the same for every viewer
- Recent Stores to quickly re-visit stores you have opened
- Shareable links: the address keeps the store, collection, filters and sort, so a link reopens the same view. Selections the collection doesn't have are dropped with a warning, and prices are clamped to its range
- A bookmarklet that opens the store you're browsing in StoreLens (see [Open a store in StoreLens](#open-a-store-in-storelens))
- Partial results with a warning if a page of products fails to load, instead of discarding what already loaded
- Clean UI built with Tailwind + shadcn/ui, in a light or dark theme: it follows your system setting, and the Theme menu in the header can override it (System, Light or Dark; remembered in this browser)  
- Per-platform differences: a Fourthwall shop's collection dropdown offers "All Products", the collection in the link and the collections you have opened on that shop before (remembered in this browser, a few handles per shop), with a note saying why it can't list the rest (Fourthwall's collections can't be read from the browser, so paste a collection's link to open one); it has no vendor, type, tag or description filtering, because Fourthwall doesn't provide that data
- Per-platform differences: a Big Cartel shop's collections are its categories (a product in several categories appears in each), "Artists" replaces the vendor filter and only shows for shops that fill it in, and there is no tag filtering because Big Cartel has no tags
- 100% client-side — no StoreLens backend, API keys or server required (your browser still talks to a few third parties; see [Privacy](#privacy))
- Static build that needs no server. Store and collection links rely on `public/_redirects` sending every path to `index.html`, which Cloudflare Pages and Netlify read. On GitHub Pages and Vercel (which ignore that file) those links would 404 unless you add an equivalent rewrite rule


## Open a store in StoreLens

A bookmarklet opens the store or collection you're looking at in StoreLens, in a new tab. To add it, create a new bookmark in your browser and paste this as its address (URL):

```
javascript:(()=>{const p=location.pathname.replace(/\/products\/.*$/,'').replace(/\/+$/,'');window.open('https://storelens.pages.dev/'+location.host+p,'_blank')})()
```

Then click the bookmark while on a store's page. It builds the same `/{host}{path}` link StoreLens uses, so:

- On a collection page (`/collections/…`, or `/category/…` on Big Cartel) it opens that collection.
- On a product page or the store's home page it opens the store, and StoreLens loads its default collection. A locale prefix such as `/en-nzd` is kept.
- It only helps on stores StoreLens supports (see [Supported platforms](#supported-platforms)). A Big Cartel shop on its own domain can't be read, as described in [Known Issues](#big-cartel).

Some sites' security settings may block bookmarklets. If yours does, paste the store's address into StoreLens instead.

## Privacy

StoreLens has no server of its own that receives store data: the page is static, and everything it shows is fetched and processed in your browser. That doesn't mean nothing leaves the browser:

- **Google Fonts.** Every visit loads the Sofia Sans Semi Condensed font from `fonts.googleapis.com` and `fonts.gstatic.com` (`index.html`), so Google sees the request (your IP address and the usual browser headers). The font is not self-hosted.
- **Cloudflare Web Analytics.** The production site at storelens.pages.dev has Cloudflare's Web Analytics beacon (`static.cloudflareinsights.com/beacon.min.js`, which reports to `cloudflareinsights.com`). It is injected by Cloudflare Pages, so it is not in this repository or in the local dev build. Whether the page URL it reports includes the path or query string (and so the store you opened) has not been verified here, so don't assume it doesn't.
- **The stores themselves.** Your browser requests the store's product feeds directly from the store (Shopify `/products.json`, `/collections.json` and `/meta.json`; Fourthwall `/collections/{handle}/{page}.json`), and loads product images from the platform's image CDN: `cdn.shopify.com` for Shopify and `imgproxy.fourthwall.dev` for Fourthwall. Big Cartel feeds come from `api.bigcartel.com`, with images from `assets.bigcartel.com`. Those image hosts come from the URLs in each live feed (for Fourthwall and Big Cartel StoreLens only passes the feed's URLs through), so they can change. These stores see your IP address, and what you open, as they would for any visitor.
- **Shared links.** A StoreLens link names a store in its address, so opening one makes the recipient's browser contact that store, as above. Only share a link with someone you'd be comfortable showing that store to.
- **Browser storage.** StoreLens keeps the following in this browser's `localStorage` only; it is never sent anywhere:
  - `storelens-theme`: your Theme menu choice (System, Light or Dark).
  - `storelens-url-history`: Recent Stores, the last five store addresses you opened.
  - `storelens:collections:v3:{platform}:{store}`: a six-hour cache of a store's collection list.
  - `storelens:platform:v1:{store}`: which platform a store was recognised as, remembered for seven days.
  - `storelens:visited-collections:v1`: the collection handles you have opened on Fourthwall shops (up to 20 per shop, 25 shops).

  Clearing the site's data in your browser removes all of it.

## Tech Stack

- React (Vite)
- Tailwind CSS v4
- shadcn/ui + Radix UI
- JavaScript
- lucide-react icons

## Development

Assuming your environment is already configured:

```bash
npm ci
npm run dev
```

Use `npm ci` rather than `npm install` for an existing clone: Node 22's npm rewrites `package-lock.json` on `npm install`, while `npm ci` leaves it alone. Use `npm install` only to change dependencies.

Development needs Node 22.22.2+ (22.x), 24.15+ (24.x) or 26+: that is the range the test tooling (jsdom 30) supports, so Node 23 and 25 are out. CI uses Node 22, and `.nvmrc` selects it (`nvm use`). `package.json` declares this range in `engines`, so `npm ci` (or `npm install`) on another Node prints one warning instead of scattered ones from dev packages.

`npm ci` and `npm install` also install the git hooks in `.githooks/` (run it again after changing one). They refuse commits and merges on `main`: work on a branch (one per issue) and merge through a pull request.

Dependabot (`.github/dependabot.yml`) opens one grouped upgrade PR per month for npm packages and one for GitHub Actions, plus grouped security fixes as they come. Review and merge them like any other PR once `test` passes.

Run the tests with `npm test` (they run offline against synthetic fixtures, never real store data) and lint with `npm run lint`.

### Platform feed smoke check

The unit tests can't notice a platform changing its feed (Fourthwall's and Big Cartel's are undocumented or legacy), so a separate script checks live sample stores:

```bash
npm run smoke
```

For each sample store it requests the feed with `Origin: https://storelens.pages.dev` and checks the HTTP status, an `Access-Control-Allow-Origin` header, the response shape, that paging terminates, and that the fields the adapters read still exist. It prints a pass/fail table (about 10 seconds) and exits non-zero only if a platform has no passing store. A store that was removed, locked or emptied shows as `GONE` rather than failing, so refresh the sample lists in `scripts/smoke-platforms.config.mjs` when that happens.

It hits real stores, so it isn't part of `npm test` or CI. **Run it by hand before each release.** It reads feeds in memory only and never saves responses.

## Browser support

StoreLens needs Chrome 111+, Edge 111+, Firefox 128+ or Safari 16.4+. That is the floor of Tailwind CSS v4, which the styling is built on ([Tailwind's browser support](https://tailwindcss.com/docs/compatibility) lists Chrome 111, Safari 16.4 and Firefox 128; Edge follows Chrome's version). The JavaScript is transpiled for slightly older browsers (`build.target` in `vite.config.js`: Chrome and Edge 107, Firefox 104, Safari 16) and relies on that without fallbacks (for example `AbortSignal.throwIfAborted`), but the CSS is the higher bar: it is built against the Tailwind floor above (`build.cssTarget` in `vite.config.js`: Chrome and Edge 111, Firefox 128, Safari 16.4), so modern colour syntax such as `oklch()` isn't rewritten for older browsers. Older browsers aren't supported.

## Status and Limitations

StoreLens should be considered in ***beta*** (0.3).

Core browsing, filtering, and sorting features are functional.

StoreLens relies on each platform’s public JSON endpoints. Stores that restrict or heavily customise their storefront data may return incomplete or inconsistent information.

**A note about very large collections:** StoreLens works by fetching every product in a collection. Extremely large catalogues may load slowly, and performance will depend on your browser and computer.

## Known Issues

### All platforms

- Known currencies are shown as symbol, amount and code ("$12.50 CAD", "£12.50 GBP"), so a CAD price is never mistaken for USD. A bare "$" with no code means the currency is unknown. This applies to every platform that reports a currency (Shopify via `/meta.json`, Big Cartel, Fourthwall); a Fourthwall shop in USD therefore reads "$12.50 USD".
- The interface text stays English and digits stay Latin (0-9) in every locale; only the digit layout and sort order follow the browser's language.
- Search does not fold ß, ø or æ ("strasse" won't find "Straße").
- Edge keeps the light favicon on dark tab strips (Safari shows a light-tile icon).

### Shopify

- Shopify enforces a limit of 1,000 collection pages (and 250 products per page).
  For a collection larger than 250,000 items StoreLens shows the first 250,000 products, with a warning.
- The products feed has no currency, so StoreLens reads the store's from its `/meta.json`; if that can't be read or is slow, prices show with "$".
- On a Markets locale path (such as `/en-ca`) prices show a bare "$" with no code, whatever the market's currency: `/meta.json` reports the store's base currency there, not the market's, and the only source that names the market's currency (`/cart.js`) can't be read from a browser.


### Fourthwall

- Variant options have no names in Fourthwall's feed (a variant is just a title such as "Black, XS"), so StoreLens guesses them: a size is labelled "Size" and anything else "Option 1", "Option 2"… Filtering by these names can group unrelated options, and a notice says so when it applies.
- Stock is reported per product, not per variant, so every size of a sold-out product reads as out of stock, and an in-stock product's sizes all read as available.
- StoreLens recognises a Fourthwall shop by its "All Products" collection (every shop tested has one), so a shop without it wouldn't be recognised.
- Loads stop after 2,000 products, with a warning.

### Big Cartel

- Only shops at `*.bigcartel.com` work. A shop on its own domain can't be read: its feed carries no CORS headers, and the CORS-enabled feed is looked up by the shop's Big Cartel name, which can't be worked out from the domain. StoreLens says so when it can't reach such a shop.
- StoreLens uses Big Cartel's legacy, undocumented product feed, which Big Cartel could change without notice. The documented API needs a login, so it can't be used.
- The largest shops tested had 35 products, all returned, so whether Big Cartel caps a very large shop's feed is untested.
- The products feed has no currency, so StoreLens reads the shop's from its `store.json`; if that can't be read or answers late, prices show with "$". A late `store.json` also skips the shortfall warning below and leaves the category dropdown alphabetical until the next read.
- The feed can't be paged, so StoreLens compares the number of products loaded with the shop's own count in `store.json` and warns when fewer loaded (a shop whose count is missing or 0 is never warned about).
- A product's sale price is only shown when the feed flags it on sale and an option costs less than the base price.
- Categories show both in the collection dropdown and as the "Category" filter. The dropdown follows the shop's category order from `store.json` and leaves out empty categories.


## License

MIT
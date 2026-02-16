# CLAUDE.md — findyl

## Project Overview

**findyl** is a UK-focused vinyl record discovery platform hosted at `findyl.co.uk`. It allows users to search for vinyl records across multiple UK retailers, view pricing information, and discover independent record stores. The site is a static frontend deployed on **Vercel** with serverless API functions.

## Tech Stack

- **Frontend**: Static HTML pages with inline CSS and JavaScript
- **Styling**: Tailwind CSS (via CDN), custom CSS, Google Fonts (DM Serif Text)
- **Backend**: Vercel Serverless Functions (Node.js, ES modules)
- **External APIs**: Discogs API (search + marketplace pricing)
- **Affiliate Partner**: POPSTORE via Awin affiliate network
- **Analytics**: Google Analytics (G-4VKXNETWR4)
- **No build step**: The site has no bundler, no package.json, no build process — HTML files are served directly

## Repository Structure

```
findyl/
├── index.html              # Homepage — search landing page with autocomplete
├── results.html            # Search results page — displays vinyl albums with retailer links
├── about.html              # About page — describes the platform
├── local-stores.html       # UK record store directory (285 stores, data inline)
├── api/
│   ├── hybrid-search.js    # Main search API — merges POPSTORE + Discogs results
│   ├── autocomplete.js     # Autocomplete API — artist/album suggestions
│   └── discogs.js          # Raw Discogs API proxy (legacy, simpler endpoint)
├── popstore-products.json  # POPSTORE product catalog (~170KB, scraped product data)
├── favicon.svg             # Vinyl record SVG favicon
├── findly-logo-desktop     # Logo asset (desktop)
├── findyl-logo-mobile      # Logo asset (mobile)
├── robots.txt              # SEO — allows all crawlers
├── sitemap.xml             # SEO — lists all pages
└── README.md               # Minimal project description
```

## Key Pages

### `index.html` — Homepage
- Full-screen coral (#FF6B6B) background with centered search
- Autocomplete dropdown powered by `/api/autocomplete`
- Dropdown menu linking to Local Stores and About pages
- Responsive: mobile shows vinyl icon button, desktop shows "Find Vinyl" text

### `results.html` — Search Results
- Calls `/api/hybrid-search?q=<query>` on page load
- Displays album cards in a grid (1/3/4 columns responsive)
- POPSTORE results appear first with direct buy links and prices
- Discogs results show marketplace pricing when available
- Each card has a "Find Retailers" toggle that expands links to 20 UK stores
- Sort controls: relevance, year, price, artist, album
- Spinning vinyl loading animation

### `about.html` — About Page
- Static informational page about the platform
- Feature cards describing search, pricing, stores, and retailers

### `local-stores.html` — Record Store Directory
- 285 UK independent record stores (data embedded in `<script>` tag)
- Filterable by name or location
- Links to Record Store Day UK pages

## API Endpoints (Vercel Serverless Functions)

All API functions live in `api/` and export a default `handler(req, res)` function using ES module syntax (`import`/`export`).

### `GET /api/hybrid-search?q=<query>`
The main search endpoint. Pipeline:
1. Search `popstore-products.json` for matching artists/albums
2. Call Discogs API (`/database/search`) for vinyl releases
3. Filter out singles, EPs, and compilations from Discogs results
4. Apply artist-matching heuristics (handles "The" prefix, collaborators, word boundaries)
5. Merge results — POPSTORE first (has prices), then Discogs
6. Deduplicate by artist + album
7. Sort by year (newest first), POPSTORE always on top
8. Fetch Discogs marketplace pricing for top 20 Discogs albums (parallel requests)
9. Return combined JSON response

### `GET /api/autocomplete?q=<query>`
Autocomplete suggestions:
1. Search POPSTORE for matching artists (max 3) and albums (max 2)
2. Search Discogs for matching artists (max 4) and albums (max 3)
3. Deduplicate and return combined suggestions (artists first, then albums)

### `GET /api/discogs?q=<query>`
Simple Discogs search proxy. Legacy endpoint — `hybrid-search` is the primary search API.

## Environment Variables

Required on Vercel:
- `DISCOGS_CONSUMER_KEY` — Discogs API consumer key
- `DISCOGS_CONSUMER_SECRET` — Discogs API consumer secret

## Data Sources

### POPSTORE Products (`popstore-products.json`)
- Pre-scraped catalog from wearepopstore.com
- Each product has: `id`, `title`, `price`, `image`, `link` (with Awin affiliate tracking), `brand`, `availability`, `artist`, `album`, `search_text`
- Links already include Awin affiliate tracking (`awinmid=118493&awinaffid=2772514`)
- This file is committed to the repo and updated manually

### Discogs API
- Used for search results and marketplace pricing
- User-Agent: `Findyl/1.0 +https://findyl.co.uk`
- Rate limited by Discogs — marketplace pricing calls are batched (top 20 only)

### UK Record Stores
- 285 stores embedded directly in `local-stores.html`
- Source: Record Store Day UK

## Design Conventions

### Brand Colors
- Primary coral: `#FF6B6B`
- Hover coral: `#FF5252`
- Text dark: `#1a1a1a`
- Light background: `#fef2f2` (for badges/highlights)

### Typography
- Headings and brand name: `DM Serif Text` (serif)
- Body text: System font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, ...`)

### UI Patterns
- Rounded corners on cards and buttons (`rounded-lg`, `rounded-full`)
- Subtle hover animations (`translateY(-2px)`, box-shadow transitions)
- Staggered fade-in animations on result cards
- Spinning vinyl SVG as loading indicator
- POPSTORE results marked with a coral dot indicator in autocomplete
- Responsive: mobile-first with breakpoints at `sm:`, `md:`, `lg:`

### Iconography
- All icons are inline SVGs (no icon library)
- Vinyl record motif used throughout (favicon, logo, loading spinner, buttons)

## Retailer Links

Results link to 20 UK vinyl retailers with search-URL patterns:
POP Store (Awin affiliate), Rough Trade, HMV, Juno Records, Amazon UK, Banquet Records, Zavvi, Rarewaves, Norman Records, Assai Records, Monorail Music, Resident Music, Piccadilly Records, Record Store, Sounds Like Vinyl, The Sound of Vinyl, Merchbar, EMP, Vinyl Castle, Lost in Vinyl

## Development Notes

### No Build System
There is no `package.json`, bundler, or build process. Edit HTML/JS files directly. Vercel deploys the repo as-is, serving HTML files as static pages and `api/*.js` files as serverless functions.

### Local Development
Use the Vercel CLI for local development:
```bash
npx vercel dev
```
This serves the static files and runs the serverless functions locally. Without it, the `/api/*` endpoints won't work locally (they'll 404 from a plain file server).

### Deployment
Push to main branch triggers automatic Vercel deployment. No CI/CD pipeline configuration files exist in the repo.

### Testing
There are no automated tests. Changes should be manually verified by:
1. Testing search with various artist names
2. Checking autocomplete suggestions appear
3. Verifying POPSTORE results show prices and buy links
4. Confirming Discogs results display correctly
5. Testing retailer link generation
6. Checking responsive behavior on mobile viewports

## Important Considerations

- **Affiliate links**: POPSTORE links use Awin affiliate tracking. Do not remove or modify the `awinmid`/`awinaffid` parameters.
- **API keys**: Discogs credentials are in environment variables, never hardcode them.
- **POPSTORE priority**: POPSTORE results always appear before Discogs results (they have prices and affiliate revenue).
- **No framework**: This is vanilla HTML/CSS/JS — do not introduce a frontend framework.
- **Inline data**: Store directory data and POPSTORE artist lists are embedded directly in HTML files. Keep this pattern unless there's a strong reason to change.
- **SEO**: Pages have proper meta tags, sitemap.xml, and robots.txt. Maintain these when adding new pages.

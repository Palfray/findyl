# CLAUDE.md — Findyl

## Project Overview

Findyl is a UK vinyl record discovery platform ([findyl.co.uk](https://findyl.co.uk)). It aggregates vinyl listings from POPSTORE (a UK retailer) and Discogs, providing pricing information and linking to local record stores. The site is a static JAMstack application deployed on Vercel with serverless API functions.

## Architecture

```
Static HTML Pages (Vanilla JS + Tailwind CSS via CDN)
        ↓
Vercel Serverless Functions (Node.js, /api/)
        ↓
External APIs (Discogs) + Local JSON Database (POPSTORE)
```

- **Frontend**: Pure HTML5 with inline vanilla JavaScript and Tailwind CSS (CDN). No frontend framework, no build step, no bundler.
- **Backend**: Three Vercel serverless functions in `/api/` using ES module syntax (`import`/`export default`).
- **Data**: `popstore-products.json` is a static local product catalog (~3,000 entries). Discogs data is fetched live via API.
- **Monetization**: POPSTORE affiliate links via Awin tracking network.

## File Structure

```
/
├── index.html              # Landing page with search box and autocomplete
├── results.html            # Search results display page
├── about.html              # About/info page
├── local-stores.html       # Directory of 285+ UK independent record stores
├── popstore-products.json  # Static POPSTORE product database
├── robots.txt              # SEO crawler rules
├── sitemap.xml             # XML sitemap
├── favicon.svg             # Brand icon
├── findyl-logo-mobile      # Mobile logo asset
├── findly-logo-desktop     # Desktop logo asset
├── api/
│   ├── hybrid-search.js    # Main search endpoint (POPSTORE + Discogs)
│   ├── autocomplete.js     # Artist/album autocomplete suggestions
│   └── discogs.js          # Simple Discogs API proxy (CORS bypass)
```

## API Endpoints

### `GET /api/hybrid-search?q=<query>`
Main search function. Multi-step process:
1. Searches `popstore-products.json` for matches (instant, with prices)
2. Queries Discogs API for vinyl releases (per_page=100)
3. Filters out singles, EPs, and compilations from Discogs results
4. Merges and deduplicates results (POPSTORE takes priority)
5. Sorts by year (newest first), POPSTORE results pinned to top
6. Fetches Discogs marketplace pricing for top 20 results (parallel)
7. Returns combined JSON response

### `GET /api/autocomplete?q=<query>`
Autocomplete suggestions. Minimum 2-character query.
- Returns up to 5 artist suggestions + 3 album suggestions
- Searches local POPSTORE data first, then queries Discogs
- Deduplicates across sources

### `GET /api/discogs?q=<query>`
Simple pass-through proxy to the Discogs search API. Exists to avoid CORS issues from client-side requests.

## Key Conventions

### Code Style
- No linter, formatter, or pre-commit hooks configured
- Inline JavaScript within HTML pages (no separate JS files)
- Inline CSS within HTML `<style>` blocks (no separate CSS files)
- ES module syntax in API functions (`import`/`export default`)
- All API handlers follow the pattern: validate method → validate query → try/catch → return JSON

### API Function Pattern
Every serverless function in `/api/` follows this structure:
```js
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const { q } = req.query;
  if (!q || q.trim() === '') {
    return res.status(400).json({ error: 'Search query required' });
  }
  try {
    // ... logic ...
    return res.status(200).json({ /* response */ });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: '...', message: error.message });
  }
}
```

### Styling
- Tailwind CSS loaded via CDN (`https://cdn.tailwindcss.com`)
- Brand color: coral `#FF6B6B` (used throughout as primary)
- Font: DM Serif Text (Google Fonts) for headings, system font stack for body
- Responsive design with mobile-first approach (media queries at 640px breakpoint)

### Search Logic
- Artist matching handles "The" prefix variations (e.g., "National" matches "The National")
- Word-boundary matching prevents false positives (e.g., "Brand New" won't match "Brand New Heavies")
- POPSTORE results always appear first (they have prices and affiliate links)
- Discogs results are filtered to exclude 7" singles, EPs, compilations, and "Various Artists"

### Data Model
POPSTORE product entry (`popstore-products.json`):
```json
{
  "id": "...",
  "title": "Artist - Album (Vinyl)",
  "price": "29.99",
  "image": "https://...",
  "link": "https://... (Awin affiliate URL)",
  "brand": "...",
  "availability": "In Stock",
  "artist": "Artist Name",
  "album": "Album Name",
  "search_text": "artist name album name"
}
```

## Environment Variables

Required in Vercel (not stored in repo):
- `DISCOGS_CONSUMER_KEY` — Discogs API consumer key
- `DISCOGS_CONSUMER_SECRET` — Discogs API consumer secret

## Deployment

- **Platform**: Vercel (automatic deployment on git push)
- **No build step**: Static files are served as-is; `/api/` functions are deployed as serverless functions
- **Domain**: findyl.co.uk
- **Analytics**: Google Analytics GA4 (ID: `G-4VKXNETWR4`)

## Development Workflow

1. Edit HTML/JS/CSS files directly — no build or compile step
2. API functions in `/api/` use Vercel's serverless function convention (export default handler)
3. Test locally with `vercel dev` (requires Vercel CLI and environment variables)
4. Push to git to deploy to Vercel

## Testing

No automated tests are configured. Testing is manual. When making changes:
- Verify search works for various artist names (single word, multi-word, "The" prefix)
- Check autocomplete returns both artist and album suggestions
- Confirm POPSTORE results appear above Discogs results
- Test mobile responsiveness (640px breakpoint)
- Verify affiliate links contain proper Awin tracking parameters

## Common Tasks

### Adding a new page
1. Create a new `.html` file at the root
2. Include Tailwind CSS CDN, Google Fonts, and Google Analytics tags (copy from `index.html` head)
3. Add navigation link in the dropdown menu of existing pages
4. Update `sitemap.xml` with the new URL

### Modifying search behavior
- Artist matching logic: `api/hybrid-search.js` lines 29-48 (POPSTORE) and lines 135-188 (Discogs)
- Result filtering (singles/EPs/compilations): `api/hybrid-search.js` lines 74-107
- Result sorting: `api/hybrid-search.js` lines 223-232

### Updating POPSTORE data
- Replace or update `popstore-products.json` at the root
- Ensure each entry has: `id`, `title`, `price`, `image`, `link`, `brand`, `availability`, `artist`, `album`, `search_text`
- The hardcoded `popstoreArtists` array in `index.html` (line 391) should also be updated to match

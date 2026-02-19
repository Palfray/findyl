/**
 * /api/ebay-search.js — eBay Browse API integration for findyl
 *
 * Searches eBay UK for vinyl records with live pricing.
 * Uses OAuth client credentials grant (Application token).
 * Includes EPN affiliate tracking via X-EBAY-C-ENDUSERCTX header.
 *
 * Query params:
 *   ?artist=Radiohead&album=OK+Computer
 *   ?q=Radiohead+OK+Computer+vinyl    (raw keyword fallback)
 *
 * Environment variables required (set in Vercel):
 *   EBAY_CLIENT_ID      — Production App ID (Client ID)
 *   EBAY_CLIENT_SECRET   — Production Cert ID (Client Secret)
 */

// ── Token cache (persists across warm invocations) ──
let cachedToken = null;
let tokenExpiry = 0;

const EPN_CAMPAIGN_ID = '5339142783';
const EBAY_VINYL_CATEGORY = '176985'; // Vinyl Records category on eBay

async function getAccessToken() {
    const now = Date.now();

    // Return cached token if still valid (with 5 min buffer)
    if (cachedToken && now < tokenExpiry - 300000) {
        return cachedToken;
    }

    const clientId = process.env.EBAY_CLIENT_ID;
    const clientSecret = process.env.EBAY_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('eBay credentials not configured');
    }

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const response = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': `Basic ${credentials}`
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope'
    });

    if (!response.ok) {
        const errText = await response.text();
        console.error('eBay token error:', response.status, errText);
        throw new Error(`eBay OAuth failed: ${response.status}`);
    }

    const data = await response.json();
    cachedToken = data.access_token;
    tokenExpiry = now + (data.expires_in * 1000); // expires_in is in seconds

    return cachedToken;
}

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600'); // 5 min cache

    const { artist, album, q } = req.query;

    // Build search query
    let searchQuery = q;
    const isAlbumSearch = !!album;

    if (!searchQuery) {
        if (!artist) {
            return res.status(400).json({ error: 'Missing artist or q parameter' });
        }
        searchQuery = album
            ? `${artist} ${album} vinyl`
            : `${artist} vinyl`;
    }

    try {
        const token = await getAccessToken();

        // Build Browse API URL
        // Artist-only: Best Match sort + high limit for diverse album coverage (used by pricing dots)
        // Artist+Album: price sort + lower limit for cheapest results (used by album page)
        const params = new URLSearchParams({
            q: searchQuery,
            category_ids: EBAY_VINYL_CATEGORY,
            filter: 'itemLocationCountry:GB,buyingOptions:{FIXED_PRICE}',
            limit: isAlbumSearch ? '20' : '200',
            auto_correct: 'KEYWORD',
            fieldgroups: 'EXTENDED,MATCHING_ITEMS'
        });

        // Only sort by price for specific album searches
        if (isAlbumSearch) {
            params.set('sort', 'price');
        }

        const apiUrl = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`;

        const response = await fetch(apiUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
                'X-EBAY-C-ENDUSERCTX': `affiliateCampaignId=${EPN_CAMPAIGN_ID},affiliateReferenceId=findyl`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('eBay search error:', response.status, errText);

            // If token expired mid-flight, clear cache and retry once
            if (response.status === 401) {
                cachedToken = null;
                tokenExpiry = 0;
                const retryToken = await getAccessToken();

                const retryResponse = await fetch(apiUrl, {
                    headers: {
                        'Authorization': `Bearer ${retryToken}`,
                        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
                        'X-EBAY-C-ENDUSERCTX': `affiliateCampaignId=${EPN_CAMPAIGN_ID},affiliateReferenceId=findyl`,
                        'Accept': 'application/json'
                    }
                });

                if (!retryResponse.ok) {
                    return res.status(502).json({ error: 'eBay API error after retry' });
                }

                const retryData = await retryResponse.json();
                return res.status(200).json(formatResults(retryData));
            }

            return res.status(502).json({ error: 'eBay API error' });
        }

        const data = await response.json();
        return res.status(200).json(formatResults(data));

    } catch (error) {
        console.error('eBay search handler error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}

function formatResults(data) {
    const items = data.itemSummaries || [];

    const results = items.map(item => {
        const price = item.price
            ? parseFloat(item.price.value)
            : null;

        const shipping = item.shippingOptions?.[0]?.shippingCost?.value
            ? parseFloat(item.shippingOptions[0].shippingCost.value)
            : null;

        // Detect vinyl colour from title + shortDescription
        const vinylColour = detectVinylColour(
            item.title || '',
            item.shortDescription || ''
        );

        return {
            title: item.title,
            price: price,
            currency: item.price?.currency || 'GBP',
            shipping: shipping,
            condition: item.condition || 'Unknown',
            image: item.image?.imageUrl || null,
            link: item.itemAffiliateWebUrl || item.itemWebUrl,
            itemId: item.itemId,
            seller: item.seller?.username || null,
            sellerRating: item.seller?.feedbackPercentage
                ? parseFloat(item.seller.feedbackPercentage)
                : null,
            vinylColour: vinylColour
        };
    });

    return {
        total: data.total || 0,
        count: results.length,
        results: results
    };
}

/**
 * Detect vinyl colour variant from listing text.
 * Returns a colour string (e.g. "Red Vinyl") or null for standard black.
 */
function detectVinylColour(title, description) {
    const text = `${title} ${description}`.toLowerCase();

    // Don't flag standard black vinyl
    // But DO flag if it says something like "black & white splatter"
    const isJustBlack = /\bblack\s+vinyl\b/.test(text)
        && !/splatter|marble|swirl|split|mix|stripe|smoke/i.test(text);

    if (isJustBlack) return null;

    // Colour patterns — ordered by specificity (multi-word first)
    const colourPatterns = [
        // Multi-colour effects
        { pattern: /\b(splatter(?:ed)?)\s*(vinyl|lp|disc)?\b/i, label: 'Splatter' },
        { pattern: /\b(marble(?:d)?)\s*(vinyl|lp|disc)?\b/i, label: 'Marble' },
        { pattern: /\b(swirl(?:ed)?)\s*(vinyl|lp|disc)?\b/i, label: 'Swirl' },
        { pattern: /\b(tie[- ]?dye(?:d)?)\s*(vinyl|lp|disc)?\b/i, label: 'Tie-Dye' },
        { pattern: /\b(galaxy)\s*(vinyl|lp|disc)?\b/i, label: 'Galaxy' },
        { pattern: /\b(haze)\s*(vinyl|lp|disc)?\b/i, label: 'Haze' },
        { pattern: /\b(smoke(?:d|y)?)\s*(vinyl|lp|disc)?\b/i, label: 'Smoke' },
        { pattern: /\b(translucent|transparent)\s*(vinyl|lp|disc)?\b/i, label: 'Translucent' },
        { pattern: /\b(picture\s*disc)\b/i, label: 'Picture Disc' },
        { pattern: /\b(glow.in.the.dark)\b/i, label: 'Glow in the Dark' },

        // Specific colours — require "vinyl", "lp", "pressing", "edition", or "coloured"
        { pattern: /\b(red)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Red' },
        { pattern: /\b(blue)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Blue' },
        { pattern: /\b(green)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Green' },
        { pattern: /\b(yellow)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Yellow' },
        { pattern: /\b(orange)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Orange' },
        { pattern: /\b(pink)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Pink' },
        { pattern: /\b(purple)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Purple' },
        { pattern: /\b(white)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'White' },
        { pattern: /\b(clear)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Clear' },
        { pattern: /\b(gold)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Gold' },
        { pattern: /\b(silver)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Silver' },
        { pattern: /\b(grey|gray)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Grey' },
        { pattern: /\b(cream)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Cream' },
        { pattern: /\b(turquoise|teal)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Turquoise' },
        { pattern: /\b(magenta)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Magenta' },
        { pattern: /\b(burgundy|maroon)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Burgundy' },
        { pattern: /\b(cobalt)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Cobalt' },
        { pattern: /\b(coral)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Coral' },
        { pattern: /\b(mint)\s+(vinyl|lp|pressing|colou?red)\b/i, label: 'Mint' },

        // Generic "coloured vinyl" catch-all
        { pattern: /\b(colou?red)\s+(vinyl|lp|pressing)\b/i, label: 'Coloured' },
        { pattern: /\b(limited)\s+(colou?r|edition)\b.*\bvinyl\b/i, label: 'Limited Colour' },
    ];

    for (const { pattern, label } of colourPatterns) {
        if (pattern.test(text)) {
            return label;
        }
    }

    return null;
}

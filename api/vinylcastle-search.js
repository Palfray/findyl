import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Fallback to GitHub if Redis is empty (first deploy before cron runs)
const VC_GITHUB_URL = 'https://raw.githubusercontent.com/Palfray/findyl/refs/heads/main/api/vinylcastle-products.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    const searchTerm = q.toLowerCase().trim();
    let allProducts = [];

    // Try Upstash Redis first
    try {
      const meta = await redis.get('feed:vc:meta');
      if (meta) {
        const parsed = typeof meta === 'string' ? JSON.parse(meta) : meta;
        const { chunks } = parsed;
        console.log(`[VC] Loading ${chunks} chunks from Upstash`);

        const chunkPromises = [];
        for (let i = 0; i < chunks; i++) {
          chunkPromises.push(redis.get(`feed:vc:${i}`));
        }
        const chunkResults = await Promise.all(chunkPromises);

        for (const chunk of chunkResults) {
          if (chunk) {
            const arr = typeof chunk === 'string' ? JSON.parse(chunk) : chunk;
            allProducts = allProducts.concat(arr);
          }
        }
        console.log(`[VC] Loaded ${allProducts.length} products from Upstash`);
      }
    } catch (redisError) {
      console.error('[VC] Upstash error:', redisError.message);
    }

    // Fallback to GitHub if Upstash is empty
    if (allProducts.length === 0) {
      console.log('[VC] Upstash empty, falling back to GitHub');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(VC_GITHUB_URL, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      allProducts = await response.json();
      console.log('[VC] Loaded:', allProducts.length, 'products from GitHub');
    }

    // Search products
    const results = allProducts.filter(product => {
      const productText = `${product.artist} ${product.album}`.toLowerCase();
      return productText.includes(searchTerm);
    }).slice(0, 50);

    console.log('[VC] Search "' + q + '" found:', results.length, 'results');
    return res.status(200).json(results);

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[VC] Request timed out');
      return res.status(408).json({ error: 'Request timeout' });
    }
    console.error('[VC] Error:', error.message);
    return res.status(500).json({ error: 'Search failed', details: error.message });
  }
}

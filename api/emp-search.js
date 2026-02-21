import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Fallback to GitHub if Redis is empty (first deploy before cron runs)
const EMP_GITHUB_URL = 'https://raw.githubusercontent.com/Palfray/findyl/refs/heads/main/api/emp-vinyl.json';

export default async function handler(req, res) {
  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Query parameter required' });
  }

  const searchTerm = q.toLowerCase().trim();

  try {
    let allProducts = [];

    // Try Upstash Redis first
    try {
      const data = await redis.get('feed:emp');
      if (data) {
        allProducts = typeof data === 'string' ? JSON.parse(data) : data;
        console.log(`[EMP] Loaded ${allProducts.length} products from Upstash`);
      }
    } catch (redisError) {
      console.error('[EMP] Upstash error:', redisError.message);
    }

    // Fallback to GitHub if Upstash is empty
    if (allProducts.length === 0) {
      console.log('[EMP] Upstash empty, falling back to GitHub');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);
      const response = await fetch(EMP_GITHUB_URL, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
      allProducts = await response.json();
      console.log('[EMP] Loaded:', allProducts.length, 'products from GitHub');
    }

    // Search products
    const results = allProducts.filter(product => {
      const productText = `${product.artist} ${product.album}`.toLowerCase();
      return productText.includes(searchTerm);
    }).slice(0, 50);

    console.log(`[EMP] Search "${searchTerm}" found:`, results.length, 'results');
    return res.status(200).json(results);

  } catch (error) {
    console.error('[EMP] Search error:', error.message);
    return res.status(500).json({ error: 'EMP search failed', message: error.message });
  }
}

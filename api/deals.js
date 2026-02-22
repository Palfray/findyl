import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const sort = req.query.sort || 'percent'; // percent | saving | price
    const minDiscount = parseFloat(req.query.min) || 0; // minimum discount %
    const maxPrice = parseFloat(req.query.max) || 999; // max price filter
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    // Load EMP products (only retailer with discount data currently)
    let allDeals = [];

    const empData = await redis.get('feed:emp');
    if (empData) {
      const products = typeof empData === 'string' ? JSON.parse(empData) : empData;
      
      // Filter to products with discounts
      const discounted = products.filter(p => 
        p.savingsPercent > minDiscount && 
        p.price > 0 && 
        p.price <= maxPrice &&
        p.rrp > p.price
      ).map(p => ({
        ...p,
        store: 'EMP',
        savingsPercent: Math.round(p.savingsPercent * 10) / 10
      }));

      allDeals = allDeals.concat(discounted);
    }

    // TODO: Add Amazon deals here when API access is available
    // TODO: Add cross-retailer price comparison deals

    // Sort
    if (sort === 'percent') {
      allDeals.sort((a, b) => b.savingsPercent - a.savingsPercent);
    } else if (sort === 'saving') {
      allDeals.sort((a, b) => b.saving - a.saving);
    } else if (sort === 'price') {
      allDeals.sort((a, b) => a.price - b.price);
    }

    const total = allDeals.length;
    const paged = allDeals.slice(offset, offset + limit);

    // Get feed freshness
    const updated = await redis.get('feed:updated');

    return res.status(200).json({
      total,
      offset,
      limit,
      sort,
      updated,
      deals: paged
    });

  } catch (error) {
    console.error('Deals error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch deals' });
  }
}

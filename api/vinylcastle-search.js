export default async function handler(req, res) {
  // Enable CORS
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
    
    // ALWAYS fetch from GitHub - file is too large for Vercel deployment
    const VC_DATA_URL = 'https://raw.githubusercontent.com/Palfray/findyl/refs/heads/main/api/vinylcastle-products.json';
    
    console.log('[VC] Fetching data from GitHub:', VC_DATA_URL);
    
    // Add 30 second timeout for large file
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(VC_DATA_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }
    
    const allProducts = await response.json();
    console.log('[VC] Loaded:', allProducts.length, 'products');
    
    // Search products
    const results = allProducts.filter(product => {
      const productText = `${product.artist} ${product.album}`.toLowerCase();
      return productText.includes(searchTerm);
    }).slice(0, 50);
    
    console.log('[VC] Search "' + q + '" found:', results.length, 'results');
    
    return res.status(200).json(results);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('[VC] Request timed out after 30 seconds');
      return res.status(408).json({ error: 'Request timeout' });
    }
    console.error('[VC] Error:', error.message);
    return res.status(500).json({ error: 'Search failed', details: error.message });
  }
}


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
    
    // Fetch VinylCastle products from GitHub raw URL
    const VC_DATA_URL = 'https://raw.githubusercontent.com/Palfray/findyl/refs/heads/main/api/vinylcastle-products.json';
    
    console.log('Fetching VinylCastle data from:', VC_DATA_URL);
    
    const response = await fetch(VC_DATA_URL);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch VinylCastle data: ${response.status}`);
    }
    
    const allProducts = await response.json();
    console.log('📦 VinylCastle loaded:', allProducts.length, 'products');
    
    // Search products
    const results = allProducts.filter(product => {
      const productText = `${product.artist} ${product.album}`.toLowerCase();
      return productText.includes(searchTerm);
    }).slice(0, 50); // Limit to 50 results
    
    console.log('VinylCastle search:', q, '→', results.length, 'results');
    
    return res.status(200).json(results);
    
  } catch (error) {
    console.error('VinylCastle search error:', error);
    return res.status(500).json({ error: 'Search failed', details: error.message });
  }
}

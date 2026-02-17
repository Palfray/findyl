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
    
    // Load VinylCastle products
    const fs = await import('fs');
    const path = await import('path');
    
    const filePath = path.join(process.cwd(), 'api', 'vinylcastle-products.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const allProducts = JSON.parse(fileContent);
    
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

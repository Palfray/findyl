// EMP Products Search Endpoint
export default async function handler(req, res) {
  const { q } = req.query;
  
  if (!q) {
    return res.status(400).json({ error: 'Query parameter required' });
  }

  const searchTerm = q.toLowerCase();
  
  try {
    // Fetch EMP data from GitHub (hosted externally to avoid Vercel size limits)
    const EMP_DATA_URL = 'https://raw.githubusercontent.com/Palfray/findyl/refs/heads/main/api/emp-vinyl.json';
    
    console.log('[EMP] Fetching data from GitHub:', EMP_DATA_URL);
    
    // Set timeout for GitHub fetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(EMP_DATA_URL, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`GitHub returned ${response.status}`);
    }
    
    const allProducts = await response.json();
    console.log('[EMP] Loaded:', allProducts.length, 'products');
    
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

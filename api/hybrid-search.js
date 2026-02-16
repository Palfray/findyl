// Minimal Working Hybrid Search - POPSTORE ONLY (to test)
// Once this works, we'll add VinylCastle back

import popstoreProducts from './popstore-products.json';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q } = req.query;
  if (!q || q.trim() === '') {
    return res.status(400).json({ error: 'Search query required' });
  }

  const searchTerm = q.toLowerCase().trim();

  try {
    console.log('🔍 Searching for:', q);
    
    // Search POPSTORE
    const popstoreResults = popstoreProducts.filter(product => {
      const artistLower = product.artist?.toLowerCase() || '';
      const albumLower = product.album?.toLowerCase() || '';
      return artistLower.includes(searchTerm) || albumLower.includes(searchTerm);
    });
    
    console.log('✅ POPSTORE found:', popstoreResults.length, 'matches');

    // Format POPSTORE results
    const results = popstoreResults.map(p => ({
      source: 'popstore',
      title: `${p.artist} - ${p.album}`,
      artist: p.artist,
      album: p.album,
      year: null,
      format: 'Vinyl',
      cover: p.image,
      price: p.price,
      currency: 'GBP',
      buy_link: p.link,
      availability: p.availability
    }));

    console.log('📤 Returning', results.length, 'results to frontend');

    return res.status(200).json({
      query: q,
      total: results.length,
      results: results
    });

  } catch (error) {
    console.error('❌ Search error:', error);
    return res.status(500).json({ 
      error: 'Search failed',
      message: error.message 
    });
  }
}

// Hybrid Search - POPSTORE + VinylCastle
import popstoreProducts from './popstore-products.json';
import vinylcastleProducts from './vinylcastle-products.json';

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

    // Search VinylCastle  
    const vinylcastleResults = vinylcastleProducts.filter(product => {
      const artistLower = product.artist?.toLowerCase() || '';
      const albumLower = product.album?.toLowerCase() || '';
      return artistLower.includes(searchTerm) || albumLower.includes(searchTerm);
    });
    
    console.log('✅ VinylCastle found:', vinylcastleResults.length, 'matches');

    // Combine results
    const results = [
      // POPSTORE first
      ...popstoreResults.map(p => ({
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
      })),
      // VinylCastle next
      ...vinylcastleResults.map(v => ({
        source: 'vinylcastle',
        title: `${v.artist} - ${v.album}`,
        artist: v.artist,
        album: v.album,
        year: null,
        format: 'Vinyl',
        cover: v.image,
        price: v.price,
        currency: 'GBP',
        buy_link: v.link,
        availability: v.availability
      }))
    ];

    console.log('📤 Returning', results.length, 'total results');

    return res.status(200).json({
      query: q,
      total: results.length,
      popstore_count: popstoreResults.length,
      vinylcastle_count: vinylcastleResults.length,
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

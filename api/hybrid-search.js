export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  console.log('=== HYBRID SEARCH START ===');
  console.log('Query:', q);

  try {
    // Test: Just call VinylCastle and return its results
    const vcUrl = `https://${req.headers.host}/api/vinylcastle-search?q=${encodeURIComponent(q)}`;
    console.log('Calling VinylCastle:', vcUrl);
    
    const vcResponse = await fetch(vcUrl);
    console.log('VinylCastle status:', vcResponse.status);
    
    if (vcResponse.ok) {
      const vcData = await vcResponse.json();
      console.log('VinylCastle returned:', vcData.length, 'results');
      
      // Format as expected by frontend
      const results = vcData.map(vc => ({
        artist: vc.artist,
        album: vc.album,
        year: null,
        format: 'Vinyl',
        cover: vc.image || '',
        buyOptions: [{
          storeName: 'Vinyl Castle',
          price: parseFloat(vc.price),
          link: vc.link,
          source: 'vinylcastle',
          availability: vc.availability || 'In Stock'
        }]
      }));
      
      console.log('Returning', results.length, 'formatted results');
      return res.status(200).json(results);
    } else {
      console.error('VinylCastle error:', vcResponse.status);
      return res.status(200).json([]);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

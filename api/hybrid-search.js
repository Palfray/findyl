// Hybrid Search API - Searches POPSTORE first, then Discogs
// Returns combined results with prices where available

import popstoreProducts from '../popstore-products.json';

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
    // Step 1: Search POPSTORE products
    const popstoreResults = popstoreProducts.filter(product => 
      product.search_text.includes(searchTerm)
    );

    console.log(`POPSTORE found ${popstoreResults.length} matches for "${q}"`);

    // Step 2: Search Discogs API
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=20&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

    const discogsResponse = await fetch(discogsUrl, {
      headers: {
        'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
      },
    });

    if (!discogsResponse.ok) {
      throw new Error(`Discogs API error: ${discogsResponse.status}`);
    }

    const discogsData = await discogsResponse.json();
    const discogsResults = discogsData.results || [];

    console.log(`Discogs found ${discogsResults.length} matches for "${q}"`);

    // Step 3: Merge results
    // POPSTORE products come first (they have prices!)
    const combinedResults = [
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
        buy_link: p.link, // Already has affiliate tracking!
        availability: p.availability
      })),
      // Then add Discogs results (deduplicate against POPSTORE)
      ...discogsResults
        .filter(d => {
          // Don't add if we already have it from POPSTORE
          const discogsTitle = d.title.toLowerCase();
          return !popstoreResults.some(p => 
            discogsTitle.includes(p.artist.toLowerCase()) && 
            discogsTitle.includes(p.album.toLowerCase())
          );
        })
        .map(d => ({
          source: 'discogs',
          title: d.title,
          artist: d.title.split(' - ')[0] || 'Unknown',
          album: d.title.split(' - ')[1] || d.title,
          year: d.year,
          format: d.format ? d.format.join(', ') : 'Vinyl',
          cover: d.cover_image || d.thumb,
          price: null, // No price from Discogs
          currency: null,
          buy_link: null,
          availability: null
        }))
    ];

    // Step 4: Deduplicate by artist + album (keep POPSTORE versions)
    const seen = new Set();
    const uniqueResults = [];
    
    for (const item of combinedResults) {
      const key = `${item.artist}||${item.album}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueResults.push(item);
      }
    }

    console.log(`Returning ${uniqueResults.length} unique results (${popstoreResults.length} from POPSTORE, ${uniqueResults.length - popstoreResults.length} from Discogs)`);

    return res.status(200).json({
      query: q,
      total: uniqueResults.length,
      popstore_count: popstoreResults.length,
      discogs_count: uniqueResults.length - popstoreResults.length,
      results: uniqueResults
    });

  } catch (error) {
    console.error('Hybrid search error:', error);
    return res.status(500).json({ 
      error: 'Failed to search vinyl records',
      message: error.message 
    });
  }
}

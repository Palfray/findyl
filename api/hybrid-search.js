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
  const searchTermLower = searchTerm; // For clarity in code

  try {
    // Step 1: Search POPSTORE products with better matching
    const searchTermLower = searchTerm.toLowerCase();
    
    const popstoreResults = popstoreProducts.filter(product => {
      const artistLower = product.artist.toLowerCase();
      const albumLower = product.album.toLowerCase();
      
      // Check if search term matches artist name (more strict)
      const artistMatch = artistLower.includes(searchTermLower) || 
                         searchTermLower.includes(artistLower);
      
      // Or if it matches the full title
      const titleMatch = product.search_text.includes(searchTermLower);
      
      // Or if searching for specific album
      const albumMatch = albumLower.includes(searchTermLower);
      
      // Must match artist OR (album AND artist is in search term)
      // This prevents "James Taylor" matching "Taylor Swift"
      if (artistMatch) {
        return true; // Direct artist match
      } else if (albumMatch && searchTermLower.split(' ').some(word => 
        word.length > 3 && artistLower.includes(word)
      )) {
        return true; // Album match but artist name is mentioned
      }
      
      return false;
    });

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
          const discogsTitle = d.title.toLowerCase();
          const discogsArtist = (d.title.split(' - ')[0] || '').toLowerCase();
          const words = discogsArtist.split(/\s+/);
          
          // Don't add if we already have it from POPSTORE
          const isDuplicate = popstoreResults.some(p => 
            discogsTitle.includes(p.artist.toLowerCase()) && 
            discogsTitle.includes(p.album.toLowerCase())
          );
          
          if (isDuplicate) return false;
          
          // If user searches for exact artist name, show all their albums
          // Check if artist name in Discogs result matches search term closely
          const searchLower = searchTermLower.trim();
          const artistLower = discogsArtist.trim();
          
          // Exact match - always include
          if (artistLower === searchLower) {
            return true;
          }
          
          // Artist name starts with or ends with search term
          if (artistLower.startsWith(searchLower) || artistLower.endsWith(searchLower)) {
            return true;
          }
          
          // Search term is contained in artist name (but check it's a full word)
          if (artistLower.includes(searchLower)) {
            // Make sure it's a word boundary match, not just substring
            const words = artistLower.split(/\s+/);
            const searchWords = searchLower.split(/\s+/);
            
            // Check if all search words appear in artist name
            const allWordsMatch = searchWords.every(searchWord => 
              words.some(word => word === searchWord || word.startsWith(searchWord))
            );
            
            if (allWordsMatch) {
              return true;
            }
          }
          
          // For multi-word searches like "Pink Floyd", be more lenient
          if (searchLower.includes(' ')) {
            const searchWords = searchLower.split(/\s+/).filter(w => w.length > 2);
            const artistWords = artistLower.split(/\s+/).filter(w => w.length > 2);
            
            // Check if most search words appear in artist
            const matchCount = searchWords.filter(sw => 
              artistWords.some(aw => aw.includes(sw) || sw.includes(aw))
            ).length;
            
            if (matchCount >= searchWords.length * 0.7) { // 70% of words match
              return true;
            }
          }
          
          // Single word searches - check if it appears in the artist name
          if (!searchLower.includes(' ')) {
            return words.some(word => word === searchLower || word.startsWith(searchLower));
          }
          
          return false;
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

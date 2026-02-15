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
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=50&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

    const discogsResponse = await fetch(discogsUrl, {
      headers: {
        'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
      },
    });

    if (!discogsResponse.ok) {
      throw new Error(`Discogs API error: ${discogsResponse.status}`);
    }

    const discogsData = await discogsResponse.json();
    let discogsResults = discogsData.results || [];
    
    // Filter to albums only - exclude singles, EPs, compilations, etc.
    discogsResults = discogsResults.filter(release => {
      const title = (release.title || '').toLowerCase();
      const formats = (release.format || []).join(' ').toLowerCase();
      
      // Exclude singles (look for "7\"", "single" in format or title)
      if (formats.includes('single') || 
          formats.includes('7"') || 
          formats.includes('7\'') ||
          title.includes('(single)')) {
        return false;
      }
      
      // Exclude EPs (look for "EP" in format or title)
      if (formats.includes('ep') || 
          title.includes('(ep)') || 
          title.match(/\bep\b/i)) {
        return false;
      }
      
      // Exclude compilations (various artists, greatest hits, best of)
      if (title.includes('compilation') ||
          title.includes('greatest hits') ||
          title.includes('best of') ||
          title.includes('the best') ||
          release.title.startsWith('Various -') ||
          release.title.startsWith('VA -')) {
        return false;
      }
      
      // Exclude maxi singles
      if (formats.includes('maxi') && formats.includes('single')) {
        return false;
      }
      
      // Only keep albums (LP, 12", Album)
      // If format explicitly says "Album" or "LP" or "12\"", keep it
      const isAlbum = formats.includes('album') || 
                      formats.includes('lp') || 
                      formats.includes('12"') ||
                      formats.includes('12\'');
      
      // If no format specified but it's not explicitly excluded above, include it
      // (some legitimate albums don't have format metadata)
      return isAlbum || formats.length === 0 || formats === 'vinyl';
    });

    console.log(`Discogs found ${discogsResults.length} album matches for "${q}" (after filtering out singles/EPs/compilations)`);

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
          
          // Match with "The" prefix
          if (artistLower === 'the ' + searchLower || searchLower === 'the ' + artistLower) {
            return true;
          }
          
          // For multi-word searches, check if it's a substring match
          if (searchLower.includes(' ')) {
            // Allow if artist name STARTS with search term
            // "brand new" matches "Brand New" but also "Brand New & X"
            if (artistLower.startsWith(searchLower)) {
              // But exclude if there's a word after that's not a common connector
              const afterSearch = artistLower.substring(searchLower.length).trim();
              
              // If nothing after, it's exact match
              if (afterSearch === '') {
                return true;
              }
              
              // If starts with common connectors, allow
              if (afterSearch.match(/^(&|and|featuring|ft\.?|feat\.?|vs\.?|with|\/)/i)) {
                return true;
              }
              
              // Otherwise check - is the next word totally different?
              // "brand new" should NOT match "brand new heavies"
              const nextWord = afterSearch.split(/\s+/)[0];
              const searchWords = searchLower.split(/\s+/);
              
              // If next word is unrelated to search, probably different artist
              if (nextWord && !searchWords.includes(nextWord.toLowerCase())) {
                return false;
              }
              
              return true;
            }
            
            // Check if all search words appear in artist name as complete words
            const searchWords = searchLower.split(/\s+/);
            const artistWords = artistLower.split(/\s+/);
            
            const allWordsMatch = searchWords.every(searchWord => 
              artistWords.some(artistWord => artistWord === searchWord)
            );
            
            if (allWordsMatch) {
              return true;
            }
            
            return false;
          }
          
          // Single word searches - match if word appears in artist name
          const words = artistLower.split(/\s+/);
          return words.some(word => word === searchLower || word.startsWith(searchLower));

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
    
    // Step 5: Sort by year (newest first) to show recent releases at top
    uniqueResults.sort((a, b) => {
      // POPSTORE items always stay at top (they have prices!)
      if (a.source === 'popstore' && b.source !== 'popstore') return -1;
      if (b.source === 'popstore' && a.source !== 'popstore') return 1;
      
      // Then sort by year
      const yearA = parseInt(a.year) || 0;
      const yearB = parseInt(b.year) || 0;
      return yearB - yearA; // Newest first
    });

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

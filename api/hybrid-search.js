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
    // For better artist-specific results, try artist search if query looks like an artist name
    let discogsUrl;
    
    // If search term doesn't include album-specific words, search by artist
    const albumKeywords = ['album', 'vinyl', 'lp', 'record', 'pressing', 'edition'];
    const hasAlbumKeyword = albumKeywords.some(keyword => q.toLowerCase().includes(keyword));
    
    if (!hasAlbumKeyword) {
      // Search specifically by artist for better results
      discogsUrl = `https://api.discogs.com/database/search?artist=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=100&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;
    } else {
      // General keyword search
      discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=100&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;
    }

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
      
      // Exclude singles (look for "7\"", "single" in format)
      if (formats.includes('7"') || formats.includes('7\'')) {
        return false;
      }
      
      // Exclude if explicitly marked as single
      if (formats.includes('single') && !formats.includes('12"')) {
        return false; // Keep 12" singles as they might be albums
      }
      
      // Exclude EPs (look for "EP" in format or title)
      if (formats.match(/\bep\b/i) && !formats.includes('lp')) {
        return false; // Exclude EP unless it also says LP
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
      
      // If we haven't excluded it, include it
      // This is more permissive - we assume most vinyl releases are albums
      // unless they're explicitly singles/EPs/compilations
      return true;
    });

    console.log(`Discogs found ${discogsResults.length} album matches for "${q}" (after filtering out singles/EPs/compilations)`);
    
    // Debug: Log first 5 results to see what we're getting
    if (discogsResults.length > 0) {
      console.log('Sample Discogs results:', discogsResults.slice(0, 5).map(r => r.title));
    }

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
          const discogsArtist = (d.title.split(' - ')[0] || '').toLowerCase().trim();
          
          // Don't add if we already have it from POPSTORE
          const isDuplicate = popstoreResults.some(p => 
            discogsTitle.includes(p.artist.toLowerCase()) && 
            discogsTitle.includes(p.album.toLowerCase())
          );
          
          if (isDuplicate) return false;
          
          // Since we're using artist= parameter in Discogs search,
          // results are already filtered by artist
          // Just do basic sanity check
          const searchLower = searchTermLower.trim();
          const searchWords = searchLower.split(/\s+/).filter(w => w.length > 2);
          const artistWords = discogsArtist.split(/\s+/).filter(w => w.length > 2);
          
          // Check if main search words appear in artist name
          // This handles variations like "The National" vs "National, The"
          const hasRelevantWords = searchWords.some(searchWord => 
            artistWords.some(artistWord => 
              artistWord === searchWord || 
              artistWord.startsWith(searchWord) ||
              searchWord.startsWith(artistWord)
            )
          );
          
          return hasRelevantWords || discogsArtist.includes(searchLower) || searchLower.includes(discogsArtist);
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

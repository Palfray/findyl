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
    // Use general search for better coverage
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=100&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

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
    
    console.log(`Discogs API returned ${discogsResults.length} raw results for "${q}"`);
    
    // Filter to albums only - exclude singles, EPs, compilations, etc.
    const beforeFilterCount = discogsResults.length;
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

    const afterAlbumFilter = discogsResults.length;
    console.log(`Album filter: ${beforeFilterCount} → ${afterAlbumFilter} (removed ${beforeFilterCount - afterAlbumFilter} singles/EPs/compilations)`);
    
    // Debug: Log first 10 results to see what we're getting
    if (discogsResults.length > 0) {
      console.log('Sample Discogs results after album filter:', discogsResults.slice(0, 10).map(r => r.title));
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
          
          const searchLower = searchTermLower.trim();
          
          // Exact match
          if (discogsArtist === searchLower) {
            return true;
          }
          
          // Handle "The" variations
          const searchWithoutThe = searchLower.replace(/^the /, '');
          const artistWithoutThe = discogsArtist.replace(/^the /, '');
          
          if (searchWithoutThe === artistWithoutThe) {
            return true;
          }
          
          // For single word searches, artist must contain the word
          if (!searchLower.includes(' ')) {
            return discogsArtist.includes(searchLower);
          }
          
          // For multi-word searches (like "Foo Fighters", "The National")
          // Check if artist starts with the search term OR contains it exactly
          if (discogsArtist.startsWith(searchLower)) {
            // Artist starts with search term
            const afterSearch = discogsArtist.substring(searchLower.length).trim();
            
            // Exact match
            if (afterSearch === '') return true;
            
            // Followed by collaborator marker
            if (afterSearch.match(/^(&|and|featuring|ft\.?|feat\.?|\/|,)/i)) {
              return true;
            }
            
            // Otherwise exclude (e.g., "Brand New Heavies" when searching "Brand New")
            return false;
          }
          
          // Check if artist contains search term exactly (with word boundaries)
          // This catches "Foo Fighters" in "The Foo Fighters" or variations
          const searchRegex = new RegExp('\\b' + searchLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
          return searchRegex.test(discogsArtist);
        })
        .map(d => ({
          source: 'discogs',
          title: d.title,
          artist: d.title.split(' - ')[0] || 'Unknown',
          album: d.title.split(' - ')[1] || d.title,
          year: d.year,
          format: d.format ? d.format.join(', ') : 'Vinyl',
          cover: d.cover_image || d.thumb,
          price: null, // Will be fetched separately for top 20
          currency: null,
          buy_link: null,
          availability: null,
          discogs_id: d.id, // Store ID for price lookup
          discogs_url: `https://www.discogs.com/release/${d.id}`
        }))
    ];
    
    const discogsAfterArtistFilter = combinedResults.filter(r => r.source === 'discogs').length;
    console.log(`Artist matching: ${afterAlbumFilter} → ${discogsAfterArtistFilter} Discogs albums (removed ${afterAlbumFilter - discogsAfterArtistFilter} non-matching artists)`);

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

    // Step 6: Fetch Discogs marketplace pricing for top 20 Discogs albums
    const discogsAlbums = uniqueResults.filter(r => r.source === 'discogs' && r.discogs_id);
    const top20Discogs = discogsAlbums.slice(0, 20);
    
    if (top20Discogs.length > 0) {
      console.log(`Fetching Discogs marketplace pricing for ${top20Discogs.length} albums...`);
      
      // Fetch prices in parallel (with error handling per album)
      const pricePromises = top20Discogs.map(async (album) => {
        try {
          const statsUrl = `https://api.discogs.com/marketplace/stats/${album.discogs_id}?curr_abbr=GBP&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;
          
          const response = await fetch(statsUrl, {
            headers: {
              'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
            },
          });
          
          if (response.ok) {
            const data = await response.json();
            
            // Get lowest price from marketplace
            if (data.lowest_price && data.lowest_price.value) {
              return {
                discogs_id: album.discogs_id,
                price: data.lowest_price.value,
                currency: data.lowest_price.currency || 'GBP'
              };
            }
          }
          
          return null;
        } catch (error) {
          console.error(`Failed to fetch price for ${album.discogs_id}:`, error.message);
          return null;
        }
      });
      
      const prices = await Promise.all(pricePromises);
      
      // Update albums with pricing data
      prices.forEach(priceData => {
        if (priceData) {
          const album = uniqueResults.find(r => r.discogs_id === priceData.discogs_id);
          if (album) {
            album.price = priceData.price;
            album.currency = priceData.currency;
            album.price_source = 'discogs_marketplace';
          }
        }
      });
      
      const pricesFound = prices.filter(p => p !== null).length;
      console.log(`Found Discogs prices for ${pricesFound}/${top20Discogs.length} albums`);
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

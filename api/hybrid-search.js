// Complete Hybrid Search - POPSTORE + VinylCastle + Discogs
// Sorted by original release date (newest first)
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
      
      // For artist matching, be more strict
      // Remove "the" from both for comparison
      const artistWithoutThe = artistLower.replace(/^the\s+/, '');
      const searchWithoutThe = searchTerm.replace(/^the\s+/, '');
      
      // Artist match: exact match or search term is contained as whole word
      const artistMatch = artistLower === searchTerm || 
                         artistWithoutThe === searchWithoutThe ||
                         artistLower.startsWith(searchTerm + ' ') ||
                         artistLower.endsWith(' ' + searchTerm) ||
                         artistLower.includes(' ' + searchTerm + ' ');
      
      // If artist matches, include it
      if (artistMatch) return true;
      
      // For album matching:
      // - Single word searches: match album title freely
      // - Multi-word searches: DON'T match album (too many false positives)
      if (searchTerm.includes(' ')) {
        // Multi-word search - already checked artist above, don't check album
        return false;
      } else {
        // Single word search - check album
        return albumLower.includes(searchTerm);
      }
    });
    
    console.log('✅ POPSTORE found:', popstoreResults.length, 'matches');

    // Search VinylCastle  
    const vinylcastleResults = vinylcastleProducts.filter(product => {
      const artistLower = product.artist?.toLowerCase() || '';
      const albumLower = product.album?.toLowerCase() || '';
      
      // Exclude cover/tribute albums
      const isCoverAlbum = albumLower.includes('tribute') || 
                          albumLower.includes('cover') ||
                          albumLower.includes('lullaby renditions') ||
                          albumLower.includes('rockabye baby') ||
                          artistLower.includes('tribute') ||
                          artistLower.includes('various');
      
      if (isCoverAlbum) return false;
      
      // For artist matching, be more strict
      const artistWithoutThe = artistLower.replace(/^the\s+/, '');
      const searchWithoutThe = searchTerm.replace(/^the\s+/, '');
      
      const artistMatch = artistLower === searchTerm || 
                         artistWithoutThe === searchWithoutThe ||
                         artistLower.startsWith(searchTerm + ' ') ||
                         artistLower.endsWith(' ' + searchTerm) ||
                         artistLower.includes(' ' + searchTerm + ' ');
      
      // If artist matches, include it
      if (artistMatch) return true;
      
      // For album matching:
      // - Single word searches: match album title freely
      // - Multi-word searches: DON'T match album (too many false positives)
      if (searchTerm.includes(' ')) {
        return false;
      } else {
        return albumLower.includes(searchTerm);
      }
    });
    
    console.log('✅ VinylCastle found:', vinylcastleResults.length, 'matches');

    // Search Discogs API
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=100&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

    const discogsResponse = await fetch(discogsUrl, {
      headers: {
        'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
      },
    });

    let discogsResults = [];
    if (discogsResponse.ok) {
      const discogsData = await discogsResponse.json();
      discogsResults = discogsData.results || [];
      
      // Filter to albums only (no singles/EPs)
      discogsResults = discogsResults.filter(release => {
        const formats = (release.format || []).join(' ').toLowerCase();
        
        // Exclude singles and EPs
        if (formats.includes('7"') || formats.includes('7\'')) return false;
        if (formats.includes('single') && !formats.includes('12"')) return false;
        if (formats.match(/\bep\b/i) && !formats.includes('lp')) return false;
        
        return true;
      });
      
      console.log('✅ Discogs found:', discogsResults.length, 'albums');
    }

    // Merge results - create album map
    const albumMap = new Map();
    
    // Add POPSTORE results
    popstoreResults.forEach(p => {
      const key = `${p.artist.toLowerCase()}|||${p.album.toLowerCase()}`;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          artist: p.artist,
          album: p.album,
          cover: p.image,
          year: null, // Will be filled from Discogs if available
          buyOptions: []
        });
      }
      albumMap.get(key).buyOptions.push({
        source: 'popstore',
        storeName: 'POP Store',
        price: p.price,
        link: p.link,
        availability: p.availability
      });
    });
    
    // Add VinylCastle results (merge with POPSTORE if same album)
    vinylcastleResults.forEach(v => {
      const key = `${v.artist.toLowerCase()}|||${v.album.toLowerCase()}`;
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          artist: v.artist,
          album: v.album,
          cover: v.image,
          year: null,
          buyOptions: []
        });
      }
      albumMap.get(key).buyOptions.push({
        source: 'vinylcastle',
        storeName: 'VinylCastle',
        price: v.price,
        link: v.link,
        availability: v.availability
      });
    });
    
    console.log('📦 Merged retailers into', albumMap.size, 'unique albums');
    
    // Add Discogs results (only if not already in retailers AND artist matches)
    discogsResults.forEach(d => {
      const discogsTitle = d.title.toLowerCase();
      
      // Extract artist from Discogs title (before first " - ")
      const parts = d.title.split(' - ');
      const artist = parts[0] || 'Unknown Artist';
      const artistLower = artist.toLowerCase();
      
      // Apply same strict artist matching as POPSTORE/VinylCastle
      const artistWithoutThe = artistLower.replace(/^the\s+/, '');
      const searchWithoutThe = searchTerm.replace(/^the\s+/, '');
      
      const artistMatch = artistLower === searchTerm || 
                         artistWithoutThe === searchWithoutThe ||
                         artistLower.startsWith(searchTerm + ' ') ||
                         artistLower.endsWith(' ' + searchTerm) ||
                         artistLower.includes(' ' + searchTerm + ' ');
      
      // For multi-word searches, ONLY include if artist matches
      // For single-word searches, can match album too
      let shouldInclude = false;
      if (searchTerm.includes(' ')) {
        // Multi-word: must match artist
        shouldInclude = artistMatch;
      } else {
        // Single word: match artist OR album
        const album = parts.slice(1).join(' - ') || d.title;
        const albumLower = album.toLowerCase();
        shouldInclude = artistMatch || albumLower.includes(searchTerm);
      }
      
      if (!shouldInclude) return;
      
      // Check if already have this album from retailers
      let isDuplicate = false;
      for (let [key, album] of albumMap) {
        if (discogsTitle.includes(album.artist.toLowerCase()) && 
            discogsTitle.includes(album.album.toLowerCase())) {
          isDuplicate = true;
          // Update year from Discogs if we don't have it
          if (!album.year && d.year) {
            album.year = parseInt(d.year);
          }
          break;
        }
      }
      
      if (!isDuplicate) {
        const albumTitle = parts.slice(1).join(' - ') || d.title;
        
        const key = `${artist.toLowerCase()}|||${albumTitle.toLowerCase()}`;
        albumMap.set(key, {
          artist: artist,
          album: albumTitle,
          cover: d.cover_image || d.thumb || 'https://via.placeholder.com/300x300?text=Vinyl+Record',
          year: d.year ? parseInt(d.year) : null,
          discogs_url: d.uri ? `https://www.discogs.com${d.uri}` : null,
          buyOptions: [] // Discogs albums have no direct buy options
        });
      }
    });
    
    console.log('📦 Total unique albums after Discogs:', albumMap.size);
    
    // Convert map to results array
    const results = Array.from(albumMap.values()).map(album => {
      const result = {
        title: `${album.artist} - ${album.album}`,
        artist: album.artist,
        album: album.album,
        year: album.year,
        format: 'Vinyl',
        cover: album.cover
      };
      
      // If has buy options, add them with lowest price first
      if (album.buyOptions && album.buyOptions.length > 0) {
        // Sort buy options by price (lowest first)
        album.buyOptions.sort((a, b) => a.price - b.price);
        
        result.buyOptions = album.buyOptions;
        result.price = album.buyOptions[0].price; // Lowest price
        result.currency = 'GBP';
      } else if (album.discogs_url) {
        // Discogs-only album
        result.discogs_url = album.discogs_url;
      }
      
      return result;
    });
    
    // Sort by release year (newest first), but retailers always at top
    results.sort((a, b) => {
      const aHasBuyOptions = a.buyOptions && a.buyOptions.length > 0;
      const bHasBuyOptions = b.buyOptions && b.buyOptions.length > 0;
      
      // Retailers first
      if (aHasBuyOptions && !bHasBuyOptions) return -1;
      if (bHasBuyOptions && !aHasBuyOptions) return 1;
      
      // Then by year (newest first)
      const yearA = a.year || 0;
      const yearB = b.year || 0;
      return yearB - yearA;
    });

    console.log('📤 Returning', results.length, 'sorted results');

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

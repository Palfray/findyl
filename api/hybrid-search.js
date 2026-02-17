export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { q } = req.query;

  if (!q) {
    return res.status(400).json({ error: 'Search query required' });
  }

  console.log('🔍 Searching for:', q);

  try {
    const searchTerm = q.toLowerCase().trim();

    // STEP 1: Search POPSTORE
    let popstoreResults = [];
    try {
      const popstoreResponse = await fetch(
        `https://www.awin1.com/cread.php?awinmid=118493&awinaffid=2772514&ued=https://www.wearepopstore.com/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=20`
      );

      if (popstoreResponse.ok) {
        const popstoreData = await popstoreResponse.json();
        popstoreResults = popstoreData.resources?.results?.products || [];
        console.log('✅ POPSTORE found:', popstoreResults.length, 'products');
      }
    } catch (error) {
      console.error('❌ POPSTORE error:', error.message);
    }

    // STEP 2: Search VinylCastle via separate endpoint (file too large to bundle)
    let vinylCastleResults = [];
    try {
      // Build the correct URL for the VinylCastle endpoint
      const baseUrl = req.headers.host ? `https://${req.headers.host}` : 'http://localhost:3000';
      const vcUrl = `${baseUrl}/api/vinylcastle-search?q=${encodeURIComponent(q)}`;
      
      console.log('🔍 Calling VinylCastle endpoint:', vcUrl);
      
      const vcResponse = await fetch(vcUrl);
      
      if (vcResponse.ok) {
        vinylCastleResults = await vcResponse.json();
        console.log('✅ VinylCastle found:', vinylCastleResults.length, 'products');
      } else {
        console.error('❌ VinylCastle endpoint returned:', vcResponse.status, vcResponse.statusText);
      }
    } catch (error) {
      console.error('❌ VinylCastle error:', error.message);
    }

    // STEP 3: Search MusicBrainz
    let musicBrainzResults = [];
    try {
      const mbResponse = await fetch(
        `https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&limit=100&fmt=json`,
        {
          headers: {
            'User-Agent': 'findyl/1.0 (https://findyl.co.uk)',
            'Accept': 'application/json'
          }
        }
      );

      if (mbResponse.ok) {
        const mbData = await mbResponse.json();
        musicBrainzResults = mbData['release-groups'] || [];
        
        // Filter to albums only (exclude singles, EPs)
        musicBrainzResults = musicBrainzResults.filter(rg => {
          const primaryType = rg['primary-type'];
          return primaryType === 'Album';
        });
        
        console.log('✅ MusicBrainz found:', musicBrainzResults.length, 'albums');
      }
    } catch (error) {
      console.error('❌ MusicBrainz error:', error.message);
    }

    // STEP 4: Merge results - create album map
    const albumMap = new Map();
    
    // Add POPSTORE results
    popstoreResults.forEach(p => {
      // Extract artist and album from title
      const titleParts = p.title.split(' - ');
      let artist = 'Unknown Artist';
      let album = p.title;
      
      if (titleParts.length >= 2) {
        artist = titleParts[0].trim();
        album = titleParts.slice(1).join(' - ').trim();
      }
      
      const key = `${artist.toLowerCase()}|||${album.toLowerCase()}`;
      
      // Build proper POPSTORE URL
      const popstoreUrl = p.url.startsWith('http') ? p.url : `https://www.wearepopstore.com${p.url}`;
      
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          artist: artist,
          album: album,
          year: null,
          format: 'Vinyl',
          cover: p.image || '',
          buyOptions: [{
            storeName: 'POP Store',
            price: parseFloat(p.price),
            link: `https://www.awin1.com/cread.php?awinmid=118493&awinaffid=2772514&ued=${encodeURIComponent(popstoreUrl)}`,
            source: 'popstore',
            availability: p.available ? 'In Stock' : 'Out of Stock'
          }]
        });
      }
    });

    // Add VinylCastle results
    vinylCastleResults.forEach(vc => {
      // Normalize album names for better matching (remove variant details)
      const cleanAlbum = vc.album
        .replace(/,.*$/, '') // Remove everything after comma (variant details)
        .replace(/\s*\(.*?\)\s*/g, '') // Remove parentheses content
        .trim();
      
      const key = `${vc.artist.toLowerCase()}|||${cleanAlbum.toLowerCase()}`;
      
      const price = parseFloat(vc.price);
      const vinylCastleOption = {
        storeName: 'Vinyl Castle',
        price: price,
        link: vc.link, // Changed from deeplink
        source: 'vinylcastle',
        availability: vc.availability || 'In Stock' // Changed from in_stock check
      };
      
      // Try to match with existing albums
      let matched = false;
      for (let [existingKey, album] of albumMap) {
        const [existingArtist, existingAlbum] = existingKey.split('|||');
        
        // Check if same artist and album title contains the clean album name
        if (existingArtist === vc.artist.toLowerCase() && 
            (existingAlbum.includes(cleanAlbum.toLowerCase()) || 
             cleanAlbum.toLowerCase().includes(existingAlbum))) {
          // Add as another buy option to existing album
          album.buyOptions.push(vinylCastleOption);
          matched = true;
          break;
        }
      }
      
      if (!matched) {
        // Create new album entry
        albumMap.set(key, {
          artist: vc.artist,
          album: cleanAlbum,
          year: null,
          format: 'Vinyl',
          cover: vc.image || '', // Changed from image_url
          buyOptions: [vinylCastleOption]
        });
      }
    });

    // Add MusicBrainz results (only if not already in retailers AND artist matches)
    musicBrainzResults.forEach(mb => {
      const artist = mb['artist-credit'] ? mb['artist-credit'][0].name : 'Unknown Artist';
      const album = mb.title;
      const artistLower = artist.toLowerCase();
      
      // Apply lenient artist matching
      const artistWithoutThe = artistLower.replace(/^the\s+/, '');
      const searchWithoutThe = searchTerm.replace(/^the\s+/, '');
      
      // For multi-word artist names, check if search terms appear in the artist
      const searchWords = searchTerm.split(' ').filter(w => w.length > 2);
      const allWordsMatch = searchWords.every(word => artistLower.includes(word.toLowerCase()));
      
      const artistMatch = artistLower === searchTerm || 
                         artistWithoutThe === searchWithoutThe ||
                         artistLower.startsWith(searchTerm) ||
                         artistLower.includes(' ' + searchTerm) ||
                         allWordsMatch;
      
      // For multi-word searches, ONLY include if artist matches
      // For single-word searches, can match album too
      let shouldInclude = false;
      if (searchTerm.includes(' ')) {
        // Multi-word: must match artist
        shouldInclude = artistMatch;
      } else {
        // Single word: match artist OR album
        const albumLower = album.toLowerCase();
        shouldInclude = artistMatch || albumLower.includes(searchTerm);
      }
      
      if (!shouldInclude) return;
      
      const key = `${artistLower}|||${album.toLowerCase()}`;
      
      // Check if already have this album from retailers
      let isDuplicate = false;
      for (let [existingKey] of albumMap) {
        if (existingKey === key) {
          isDuplicate = true;
          // Update year from MusicBrainz if we don't have it
          const existing = albumMap.get(key);
          if (!existing.year && mb['first-release-date']) {
            existing.year = mb['first-release-date'].substring(0, 4);
          }
          break;
        }
      }
      
      if (!isDuplicate) {
        // Add new MusicBrainz-only album
        const mbid = mb.id;
        const year = mb['first-release-date'] ? mb['first-release-date'].substring(0, 4) : null;
        
        albumMap.set(key, {
          artist: artist,
          album: album,
          year: year,
          format: 'Vinyl',
          cover: `https://coverartarchive.org/release-group/${mbid}/front-500`,
          buyOptions: [],
          musicbrainz_url: `https://musicbrainz.org/release-group/${mbid}`,
          musicbrainz_id: mbid
        });
      }
    });

    // Convert map to array and sort by price
    let results = Array.from(albumMap.values());
    
    // Sort: albums with buy options first (by lowest price), then MusicBrainz-only
    results.sort((a, b) => {
      const aHasPrice = a.buyOptions.length > 0;
      const bHasPrice = b.buyOptions.length > 0;
      
      if (aHasPrice && !bHasPrice) return -1;
      if (!aHasPrice && bHasPrice) return 1;
      
      if (aHasPrice && bHasPrice) {
        const aMinPrice = Math.min(...a.buyOptions.map(opt => opt.price));
        const bMinPrice = Math.min(...b.buyOptions.map(opt => opt.price));
        return aMinPrice - bMinPrice;
      }
      
      // Both have no prices - sort by year (newest first)
      if (a.year && b.year) {
        return parseInt(b.year) - parseInt(a.year);
      }
      if (a.year) return -1;
      if (b.year) return 1;
      
      return 0;
    });

    console.log('📦 Total unique albums:', results.length);
    
    const withBuyOptions = results.filter(r => r.buyOptions.length > 0).length;
    const musicBrainzOnly = results.filter(r => r.buyOptions.length === 0).length;
    console.log(`💰 With prices: ${withBuyOptions}, 🎵 MusicBrainz only: ${musicBrainzOnly}`);

    return res.status(200).json(results);

  } catch (error) {
    console.error('Search error:', error);
    return res.status(500).json({ error: 'Search failed', details: error.message });
  }
}

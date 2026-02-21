import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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
    // Normalize: strip punctuation for matching
    const normalize = s => s.toLowerCase().replace(/[.\-'",!?()]/g, '').replace(/\s+/g, ' ').trim();

    // STEP 1: Search POPSTORE (from Upstash, fallback to live AWIN redirect)
    let popstoreResults = [];
    try {
      // Try Upstash first
      const popData = await redis.get('feed:popstore');
      if (popData) {
        const allPop = typeof popData === 'string' ? JSON.parse(popData) : popData;
        console.log(`✅ POPSTORE: ${allPop.length} total products in Upstash`);
        // Filter to matching products
        popstoreResults = allPop.filter(p => {
          const text = normalize(`${p.artist} ${p.album} ${p.title || ''} ${p.product_name || ''}`);
          const words = normalize(searchTerm).split(/\s+/);
          return words.every(w => text.includes(w));
        }).slice(0, 20);
        console.log('✅ POPSTORE matched:', popstoreResults.length, 'products');
      } else {
        // Fallback to live AWIN redirect
        console.log('⚠️ POPSTORE: Upstash empty, trying live API');
        const popstoreResponse = await fetch(
          `https://www.awin1.com/cread.php?awinmid=118493&awinaffid=2772514&ued=https://www.wearepopstore.com/search/suggest.json?q=${encodeURIComponent(q)}&resources[type]=product&resources[limit]=20`
        );
        if (popstoreResponse.ok) {
          const popstoreData = await popstoreResponse.json();
          popstoreResults = popstoreData.resources?.results?.products || [];
          console.log('✅ POPSTORE (live) found:', popstoreResults.length, 'products');
        }
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
      
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const vcResponse = await fetch(vcUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      
      if (vcResponse.ok) {
        vinylCastleResults = await vcResponse.json();
        console.log('✅ VinylCastle found:', vinylCastleResults.length, 'products');
        
        if (vinylCastleResults.length > 0) {
          console.log('First VC result:', JSON.stringify(vinylCastleResults[0]));
        }
      } else {
        const errorText = await vcResponse.text();
        console.error('❌ VinylCastle endpoint returned:', vcResponse.status, vcResponse.statusText);
        console.error('Error details:', errorText);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('❌ VinylCastle request timed out after 10 seconds');
      } else {
        console.error('❌ VinylCastle error:', error.message);
      }
    }

    // STEP 2.5: Search EMP
    let empResults = [];
    try {
      const empUrl = `https://www.findyl.co.uk/api/emp-search?q=${encodeURIComponent(q)}`;
      console.log('🔍 Calling EMP endpoint:', empUrl);
      
      const empController = new AbortController();
      const empTimeoutId = setTimeout(() => empController.abort(), 10000); // 10 second timeout
      
      const empResponse = await fetch(empUrl, {
        signal: empController.signal,
        headers: {
          'User-Agent': 'findyl/1.0 (https://findyl.co.uk)'
        }
      });
      
      clearTimeout(empTimeoutId);
      
      if (empResponse.ok) {
        empResults = await empResponse.json();
        console.log('✅ EMP found:', empResults.length, 'products');
      } else {
        console.error('❌ EMP endpoint returned:', empResponse.status);
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('❌ EMP request timed out after 10 seconds');
      } else {
        console.error('❌ EMP error:', error.message);
      }
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
        
        // Filter to OFFICIAL STUDIO ALBUMS only (exclude singles, EPs, compilations, live, etc.)
        musicBrainzResults = musicBrainzResults.filter(rg => {
          const primaryType = rg['primary-type'];
          const secondaryTypes = rg['secondary-types'] || [];
          
          // Must be a primary Album
          if (primaryType !== 'Album') return false;
          
          // Exclude compilations, live albums, soundtracks, remixes
          const excludedTypes = ['compilation', 'live', 'soundtrack', 'remix', 'dj-mix', 'mixtape/street'];
          const hasExcludedType = secondaryTypes.some(type => 
            excludedTypes.includes(type.toLowerCase())
          );
          
          if (hasExcludedType) return false;
          
          return true;
        });
        
        console.log('✅ MusicBrainz found:', musicBrainzResults.length, 'studio albums');
      }
    } catch (error) {
      console.error('❌ MusicBrainz error:', error.message);
    }

    // STEP 4: Merge results - create album map
    const albumMap = new Map();
    
    // Add POPSTORE results
    popstoreResults.forEach(p => {
      // Handle both formats: Upstash (has artist/album/link) and live API (has title/url)
      let artist, album, popstoreUrl, rawTitle;

      if (p.artist && p.album) {
        // Upstash format
        artist = p.artist;
        album = p.album;
        popstoreUrl = p.link || p.url || '';
        rawTitle = p.title || p.product_name || `${p.artist} - ${p.album}`;
      } else {
        // Live API format: title = "Artist - Album, Vinyl"
        const titleParts = (p.title || '').split(' - ');
        artist = 'Unknown Artist';
        album = p.title || '';

        if (titleParts.length >= 2) {
          artist = titleParts[0].trim();
          album = titleParts.slice(1).join(' - ').trim();
        }
        const rawUrl = p.url || '';
        popstoreUrl = rawUrl.startsWith('http') ? rawUrl : `https://www.wearepopstore.com${rawUrl}`;
        rawTitle = p.title || '';
      }
      
      // Filter by artist for multi-word searches
      if (searchTerm.includes(' ')) {
        const artistNorm = normalize(artist);
        const searchNorm = normalize(searchTerm);
        const artistWithoutThe = artistNorm.replace(/^the\s+/, '');
        const searchWithoutThe = searchNorm.replace(/^the\s+/, '');
        
        const artistMatch = artistNorm === searchNorm || 
          searchNorm.startsWith(artistNorm + ' ') ||
          searchNorm.startsWith(artistWithoutThe + ' ') ||
          artistNorm.startsWith(searchNorm + ' ') ||
          artistNorm === searchWithoutThe ||
          artistWithoutThe === searchWithoutThe;
        
        if (!artistMatch) {
          console.log(`  ❌ POPSTORE: Filtered out "${artist}" - doesn't match "${searchTerm}"`);
          return; // Skip this result
        }
      }
      
      // Clean album name (remove vinyl variants/editions)
      const cleanAlbum = album
        .replace(/,.*$/, '') // Remove everything after comma
        .replace(/\(.*?\)/g, '') // Remove parentheses content
        .replace(/\b(vinyl|lp|2xlp|3xlp|double|triple|deluxe|limited|edition|gatefold|coloured|colored)\b/gi, '') // Remove format words
        .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
        .trim();
      
      const key = `${artist.toLowerCase()}|||${cleanAlbum.toLowerCase()}`;
      
      console.log(`POPSTORE: "${album}" → "${cleanAlbum}"`);
      
      // Build proper POPSTORE affiliate URL
      const affiliateLink = popstoreUrl.includes('awin1.com') 
        ? popstoreUrl 
        : `https://www.awin1.com/cread.php?awinmid=118493&awinaffid=2772514&ued=${encodeURIComponent(popstoreUrl)}`;
      
      if (!albumMap.has(key)) {
        albumMap.set(key, {
          artist: artist,
          album: cleanAlbum,
          year: null,
          format: 'Vinyl',
          cover: p.image || '',
          buyOptions: [{
            storeName: 'POP Store',
            price: parseFloat(p.price),
            link: affiliateLink,
            source: 'popstore',
            availability: p.availability || (p.available ? 'In Stock' : 'Out of Stock'),
            rawProductName: rawTitle
          }]
        });
      }
    });

    // Add VinylCastle results
    console.log('🔄 Processing', vinylCastleResults.length, 'VinylCastle results');
    
    vinylCastleResults.forEach((vc, idx) => {
      // Filter by artist for multi-word searches
      if (searchTerm.includes(' ')) {
        const artistNorm = normalize(vc.artist);
        const searchNorm = normalize(searchTerm);
        const artistWithoutThe = artistNorm.replace(/^the\s+/, '');
        const searchWithoutThe = searchNorm.replace(/^the\s+/, '');
        
        const artistMatch = artistNorm === searchNorm || 
          searchNorm.startsWith(artistNorm + ' ') ||
          searchNorm.startsWith(artistWithoutThe + ' ') ||
          artistNorm.startsWith(searchNorm + ' ') ||
          artistNorm === searchWithoutThe ||
          artistWithoutThe === searchWithoutThe;
        
        if (!artistMatch) {
          console.log(`  ❌ VC: Filtered out "${vc.artist}" - doesn't match "${searchTerm}"`);
          return; // Skip this result
        }
      }
      
      // Normalize album names for better matching (remove variant details)
      const cleanAlbum = vc.album
        .replace(/,.*$/, '') // Remove everything after comma (variant details)
        .replace(/\(.*?\)/g, '') // Remove parentheses content
        .replace(/\b(vinyl|lp|2xlp|3xlp|double|triple|deluxe|limited|edition|gatefold|coloured|colored)\b/gi, '') // Remove format words
        .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
        .trim();
      
      console.log(`VC ${idx + 1}: "${vc.album}" → "${cleanAlbum}"`);
      
      const key = `${vc.artist.toLowerCase()}|||${cleanAlbum.toLowerCase()}`;
      
      const price = parseFloat(vc.price);
      const vinylCastleOption = {
        storeName: 'Vinyl Castle',
        price: price,
        link: vc.link,
        source: 'vinylcastle',
        availability: vc.availability || 'In Stock',
        rawProductName: vc.product_name || vc.productName || vc.name || vc.title || vc.album || ''
      };
      
      // Try to match with existing albums
      let matched = false;
      for (let [existingKey, album] of albumMap) {
        const [existingArtist, existingAlbum] = existingKey.split('|||');
        
        // Check if same artist
        if (existingArtist === vc.artist.toLowerCase()) {
          const cleanVcAlbum = cleanAlbum.toLowerCase();
          const cleanExistingAlbum = existingAlbum;
          
          // Remove "the" from start for comparison
          const vcWithoutThe = cleanVcAlbum.replace(/^the\s+/i, '');
          const existingWithoutThe = cleanExistingAlbum.replace(/^the\s+/i, '');
          
          // Check multiple match conditions
          const exactMatch = cleanExistingAlbum === cleanVcAlbum;
          const theMatch = vcWithoutThe === existingWithoutThe;
          const containsMatch = cleanExistingAlbum.includes(cleanVcAlbum) || cleanVcAlbum.includes(cleanExistingAlbum);
          
          if (exactMatch || theMatch || containsMatch) {
            // Add as another buy option to existing album
            console.log(`  ✅ Matched with existing album:`, existingKey);
            album.buyOptions.push(vinylCastleOption);
            matched = true;
            break;
          }
        }
      }
      
      if (!matched) {
        // Create new album entry
        console.log(`  ➕ Creating new album entry:`, key);
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

    // Add EMP results
    console.log('🔄 Processing', empResults.length, 'EMP results');
    
    empResults.forEach((emp, idx) => {
      // Filter by artist for multi-word searches
      if (searchTerm.includes(' ')) {
        const artistNorm = normalize(emp.artist);
        const searchNorm = normalize(searchTerm);
        const artistWithoutThe = artistNorm.replace(/^the\s+/, '');
        const searchWithoutThe = searchNorm.replace(/^the\s+/, '');
        
        const artistMatch = artistNorm === searchNorm || 
          searchNorm.startsWith(artistNorm + ' ') ||
          searchNorm.startsWith(artistWithoutThe + ' ') ||
          artistNorm.startsWith(searchNorm + ' ') ||
          artistNorm === searchWithoutThe ||
          artistWithoutThe === searchWithoutThe;
        
        if (!artistMatch) {
          console.log(`  ❌ EMP: Filtered out "${emp.artist}" - doesn't match "${searchTerm}"`);
          return;
        }
      }
      
      // Clean album name
      const cleanAlbum = emp.album
        .replace(/,.*$/, '')
        .replace(/\(.*?\)/g, '')
        .replace(/\b(vinyl|lp|2xlp|3xlp|double|triple|deluxe|limited|edition|gatefold|coloured|colored)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      console.log(`EMP ${idx + 1}: "${emp.album}" → "${cleanAlbum}"`);
      
      const key = `${emp.artist.toLowerCase()}|||${cleanAlbum.toLowerCase()}`;
      const price = parseFloat(emp.price);
      
      const empOption = {
        storeName: 'EMP',
        price: price,
        link: emp.link,
        source: 'emp',
        availability: emp.availability || 'In Stock',
        rawProductName: emp.product_name || emp.productName || emp.name || emp.title || emp.album || ''
      };
      
      // Try to match with existing albums
      let matched = false;
      for (let [existingKey, album] of albumMap) {
        const [existingArtist, existingAlbum] = existingKey.split('|||');
        
        if (existingArtist === emp.artist.toLowerCase()) {
          const cleanEmpAlbum = cleanAlbum.toLowerCase();
          const cleanExistingAlbum = existingAlbum;
          
          const empWithoutThe = cleanEmpAlbum.replace(/^the\s+/i, '');
          const existingWithoutThe = cleanExistingAlbum.replace(/^the\s+/i, '');
          
          const exactMatch = cleanExistingAlbum === cleanEmpAlbum;
          const theMatch = empWithoutThe === existingWithoutThe;
          const containsMatch = cleanExistingAlbum.includes(cleanEmpAlbum) || cleanEmpAlbum.includes(cleanExistingAlbum);
          
          if (exactMatch || theMatch || containsMatch) {
            console.log(`  ✅ Matched with existing album:`, existingKey);
            album.buyOptions.push(empOption);
            matched = true;
            break;
          }
        }
      }
      
      if (!matched) {
        console.log(`  ➕ Creating new album entry:`, key);
        albumMap.set(key, {
          artist: emp.artist,
          album: cleanAlbum,
          year: null,
          format: 'Vinyl',
          cover: emp.image || '',
          buyOptions: [empOption]
        });
      }
    });

    // Add MusicBrainz results (only if not already in retailers AND artist matches)
    musicBrainzResults.forEach(mb => {
      const artist = mb['artist-credit'] ? mb['artist-credit'][0].name : 'Unknown Artist';
      const album = mb.title;
      const artistLower = artist.toLowerCase();
      
      // Apply strict artist matching for multi-word searches
      const artistWithoutThe = artistLower.replace(/^the\s+/, '');
      const searchWithoutThe = searchTerm.replace(/^the\s+/, '');
      
      // Strict matching for multi-word searches (like "the national")
      const exactMatch = artistLower === searchTerm;
      const exactWithoutThe = artistWithoutThe === searchWithoutThe;
      const startsWithMatch = artistLower.startsWith(searchTerm + ' ') || artistLower === searchTerm;
      
      // For searches starting with "the", be very strict
      const isTheSearch = searchTerm.startsWith('the ');
      
      let artistMatch;
      if (isTheSearch) {
        // For "the X" searches, ONLY match if artist is exactly "the X" or "X"
        artistMatch = exactMatch || exactWithoutThe;
      } else if (searchTerm.includes(' ')) {
        // For multi-word searches, require exact match or starts with
        artistMatch = exactMatch || startsWithMatch;
      } else {
        // For single-word searches, be more lenient
        artistMatch = artistLower === searchTerm || 
                     artistLower.startsWith(searchTerm) ||
                     artistLower.includes(' ' + searchTerm);
      }
      
      // For multi-word searches, ONLY include if artist matches
      // For single-word searches, can match album too
      let shouldInclude = false;
      if (searchTerm.includes(' ')) {
        // Multi-word: must match artist exactly
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
        
        console.log(`  ➕ Adding MusicBrainz album: "${artist}" - "${album}" (${year || 'no year'})`);
        
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

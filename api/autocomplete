// API endpoint for artist autocomplete
// Searches POPSTORE + Discogs for artist suggestions

import popstoreProducts from '../popstore-products.json';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  const searchTerm = q.toLowerCase().trim();

  try {
    // Get unique POPSTORE artists
    const popstoreArtistSet = new Set();
    popstoreProducts.forEach(product => {
      popstoreArtistSet.add(product.artist);
    });
    
    const popstoreArtists = Array.from(popstoreArtistSet);
    
    // Filter POPSTORE artists that match
    const popstoreMatches = popstoreArtists
      .filter(artist => artist.toLowerCase().includes(searchTerm))
      .slice(0, 3) // Max 3 from POPSTORE
      .map(artist => ({
        name: artist,
        source: 'popstore'
      }));

    console.log(`POPSTORE: ${popstoreMatches.length} matches for "${q}"`);

    // Search Discogs API for broader coverage
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=artist&per_page=10&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

    const discogsResponse = await fetch(discogsUrl, {
      headers: {
        'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
      },
    });

    let discogsMatches = [];

    if (discogsResponse.ok) {
      const discogsData = await discogsResponse.json();
      
      // Get artists directly from artist search
      let artistNames = (discogsData.results || [])
        .filter(result => result.type === 'artist')
        .map(result => result.title);
      
      // If we didn't get many artist results, also search releases and extract artist names
      if (artistNames.length < 5) {
        const releaseUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=30&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;
        
        try {
          const releaseResponse = await fetch(releaseUrl, {
            headers: {
              'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
            },
          });
          
          if (releaseResponse.ok) {
            const releaseData = await releaseResponse.json();
            
            // Extract unique artist names from release titles (format: "Artist - Album")
            const artistSet = new Set(artistNames);
            (releaseData.results || []).forEach(result => {
              if (result.title && result.title.includes(' - ')) {
                const artistName = result.title.split(' - ')[0].trim();
                const artistLower = artistName.toLowerCase();
                
                // Only include if artist name contains search term
                if (artistLower.includes(searchTerm)) {
                  artistSet.add(artistName);
                }
              }
            });
            
            artistNames = Array.from(artistSet);
          }
        } catch (releaseError) {
          console.error('Discogs release search error:', releaseError);
        }
      }
      
      discogsMatches = artistNames
        // Remove duplicates from POPSTORE
        .filter(artist => 
          !popstoreMatches.some(pm => pm.name.toLowerCase() === artist.toLowerCase())
        )
        .slice(0, 7) // Max 7 from Discogs
        .map(artist => ({
          name: artist,
          source: 'discogs'
        }));

      console.log(`Discogs: ${discogsMatches.length} matches for "${q}"`);
    } else {
      console.error(`Discogs API error: ${discogsResponse.status}`);
    }

    // Combine: POPSTORE first, then Discogs
    const allMatches = [...popstoreMatches, ...discogsMatches].slice(0, 8);

    return res.status(200).json({
      query: q,
      total: allMatches.length,
      suggestions: allMatches
    });

  } catch (error) {
    console.error('Autocomplete error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch suggestions',
      message: error.message 
    });
  }
}

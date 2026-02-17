// API endpoint for artist autocomplete
// Searches POPSTORE + MusicBrainz for artist suggestions

import popstoreProducts from './popstore-products.json';

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
    // Step 1: Get POPSTORE suggestions (artists + albums)
    const popstoreArtistSet = new Set();
    const popstoreAlbums = [];
    
    popstoreProducts.forEach(product => {
      const artist = product.artist;
      const album = product.album;
      
      // Add unique artists
      popstoreArtistSet.add(artist);
      
      // Check if album name matches search
      if (album.toLowerCase().includes(searchTerm)) {
        popstoreAlbums.push({
          type: 'album',
          artist: artist,
          album: album,
          source: 'popstore'
        });
      }
    });
    
    const popstoreArtists = Array.from(popstoreArtistSet);
    
    // Filter POPSTORE artists that match
    const popstoreArtistMatches = popstoreArtists
      .filter(artist => artist.toLowerCase().includes(searchTerm))
      .slice(0, 3) // Max 3 artists from POPSTORE
      .map(artist => ({
        type: 'artist',
        name: artist,
        source: 'popstore'
      }));
    
    // Limit POPSTORE album matches
    const popstoreAlbumMatches = popstoreAlbums.slice(0, 2); // Max 2 albums from POPSTORE

    console.log(`POPSTORE: ${popstoreArtistMatches.length} artist matches, ${popstoreAlbumMatches.length} album matches for "${q}"`);

    // Step 2: Search MusicBrainz for artists
    const musicbrainzUrl = `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(q)}&fmt=json&limit=10`;

    const musicbrainzResponse = await fetch(musicbrainzUrl, {
      headers: {
        'User-Agent': 'findyl/1.0 (https://findyl.co.uk)',
      },
    });

    let musicbrainzArtistMatches = [];

    if (musicbrainzResponse.ok) {
      const musicbrainzData = await musicbrainzResponse.json();
      
      // Filter and map MusicBrainz artists
      musicbrainzArtistMatches = (musicbrainzData.artists || [])
        .filter(artist => {
          const name = artist.name.toLowerCase();
          const searchLower = searchTerm.toLowerCase();
          // Only include if name matches search term
          return name.includes(searchLower) || searchLower.includes(name);
        })
        // Remove duplicates from POPSTORE
        .filter(artist => 
          !popstoreArtistMatches.some(pm => pm.name.toLowerCase() === artist.name.toLowerCase())
        )
        .slice(0, 4) // Max 4 artists from MusicBrainz
        .map(artist => ({
          type: 'artist',
          name: artist.name,
          disambiguation: artist.disambiguation || '',
          country: artist.country || '',
          source: 'musicbrainz'
        }));

      console.log(`MusicBrainz: ${musicbrainzArtistMatches.length} artist matches for "${q}"`);
    } else {
      console.error(`MusicBrainz API error: ${musicbrainzResponse.status}`);
    }

    // Step 3: Combine all suggestions (artists first, then albums)
    const allArtists = [...popstoreArtistMatches, ...musicbrainzArtistMatches];
    const allAlbums = [...popstoreAlbumMatches];
    
    // Prioritize: Artists first (max 5), then albums (max 3)
    const allMatches = [
      ...allArtists.slice(0, 5),
      ...allAlbums.slice(0, 3)
    ];

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

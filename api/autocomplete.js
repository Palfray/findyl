// API endpoint for artist autocomplete
// Searches POPSTORE + Discogs for artist suggestions

import popstoreProducts from '../popstore-products.json';
import vinylcastleProducts from '../vinylcastle-products.json';

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
    // Step 1: Get retailer suggestions (POPSTORE + VinylCastle artists + albums)
    const retailerArtistSet = new Set();
    const retailerAlbums = [];

    // Process POPSTORE products
    popstoreProducts.forEach(product => {
      retailerArtistSet.add(product.artist);
      if (product.album.toLowerCase().includes(searchTerm)) {
        retailerAlbums.push({
          type: 'album',
          artist: product.artist,
          album: product.album,
          source: 'popstore'
        });
      }
    });

    // Process VinylCastle products
    vinylcastleProducts.forEach(product => {
      retailerArtistSet.add(product.artist);
      if (product.album.toLowerCase().includes(searchTerm)) {
        retailerAlbums.push({
          type: 'album',
          artist: product.artist,
          album: product.album,
          source: 'vinylcastle'
        });
      }
    });

    const retailerArtists = Array.from(retailerArtistSet);

    // Filter retailer artists that match
    const popstoreArtistMatches = retailerArtists
      .filter(artist => artist.toLowerCase().includes(searchTerm))
      .slice(0, 3) // Max 3 artists from retailers
      .map(artist => ({
        type: 'artist',
        name: artist,
        source: 'popstore'
      }));

    // Deduplicate album matches by artist+album
    const seenRetailerAlbums = new Set();
    const dedupedAlbums = retailerAlbums.filter(a => {
      const key = `${a.artist.toLowerCase()}-${a.album.toLowerCase()}`;
      if (seenRetailerAlbums.has(key)) return false;
      seenRetailerAlbums.add(key);
      return true;
    });

    // Limit retailer album matches
    const popstoreAlbumMatches = dedupedAlbums.slice(0, 2); // Max 2 albums from retailers

    console.log(`Retailers: ${popstoreArtistMatches.length} artist matches, ${popstoreAlbumMatches.length} album matches for "${q}"`);

    // Step 2: Search Discogs for artists AND albums
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=20&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

    const discogsResponse = await fetch(discogsUrl, {
      headers: {
        'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
      },
    });

    let discogsArtistMatches = [];
    let discogsAlbumMatches = [];

    if (discogsResponse.ok) {
      const discogsData = await discogsResponse.json();
      
      const artistSet = new Set();
      const albums = [];
      
      // Process releases to extract both artists and albums
      (discogsData.results || []).forEach(result => {
        if (result.title && result.title.includes(' - ')) {
          const parts = result.title.split(' - ');
          const artistName = parts[0].trim();
          const albumName = parts.slice(1).join(' - ').trim(); // Handle multi-dash titles
          
          const artistLower = artistName.toLowerCase();
          const albumLower = albumName.toLowerCase();
          
          // Add artist if it matches search term
          if (artistLower.includes(searchTerm)) {
            artistSet.add(artistName);
          }
          
          // Add album if album name matches search term
          if (albumLower.includes(searchTerm)) {
            albums.push({
              type: 'album',
              artist: artistName,
              album: albumName,
              source: 'discogs'
            });
          }
        }
      });
      
      // Convert artists to matches
      discogsArtistMatches = Array.from(artistSet)
        // Remove duplicates from POPSTORE
        .filter(artist => 
          !popstoreArtistMatches.some(pm => pm.name.toLowerCase() === artist.toLowerCase())
        )
        .slice(0, 4) // Max 4 artists from Discogs
        .map(artist => ({
          type: 'artist',
          name: artist,
          source: 'discogs'
        }));
      
      // Get unique albums (deduplicate by album name)
      const uniqueAlbums = [];
      const seenAlbums = new Set();
      
      albums.forEach(album => {
        const key = `${album.artist.toLowerCase()}-${album.album.toLowerCase()}`;
        if (!seenAlbums.has(key)) {
          seenAlbums.add(key);
          uniqueAlbums.push(album);
        }
      });
      
      discogsAlbumMatches = uniqueAlbums.slice(0, 3); // Max 3 albums from Discogs

      console.log(`Discogs: ${discogsArtistMatches.length} artist matches, ${discogsAlbumMatches.length} album matches for "${q}"`);
    } else {
      console.error(`Discogs API error: ${discogsResponse.status}`);
    }

    // Step 3: Combine all suggestions (artists first, then albums)
    const allArtists = [...popstoreArtistMatches, ...discogsArtistMatches];
    const allAlbums = [...popstoreAlbumMatches, ...discogsAlbumMatches];
    
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

// /api/spotify-artist.js
// Vercel serverless function - fetches artist data + images from Spotify Web API
// Uses Client Credentials flow (no user auth needed)

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
  // Return cached token if still valid (with 60s buffer)
  if (cachedToken && Date.now() < tokenExpiry - 60000) {
    return cachedToken;
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Spotify credentials not configured');
  }

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) {
    throw new Error('Failed to get Spotify access token');
  }

  const data = await response.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + (data.expires_in * 1000);
  return cachedToken;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=43200'); // Cache 24h

  const { name } = req.query;

  if (!name) {
    return res.status(400).json({ error: 'Missing "name" query parameter' });
  }

  try {
    const token = await getAccessToken();

    // Search for artist on Spotify
    const searchUrl = `https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(name)}&type=artist&limit=5&market=GB`;
    const searchResponse = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!searchResponse.ok) {
      throw new Error(`Spotify search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();
    const artists = searchData.artists?.items || [];

    if (artists.length === 0) {
      return res.status(200).json({ found: false, artist: null });
    }

    // Try to find exact match first, otherwise use top result
    const exactMatch = artists.find(a => a.name.toLowerCase() === name.toLowerCase());
    const artist = exactMatch || artists[0];

    // Return cleaned artist data
    return res.status(200).json({
      found: true,
      artist: {
        spotifyId: artist.id,
        name: artist.name,
        genres: artist.genres || [],
        popularity: artist.popularity,
        followers: artist.followers?.total || 0,
        spotifyUrl: artist.external_urls?.spotify || null,
        images: (artist.images || []).map(img => ({
          url: img.url,
          width: img.width,
          height: img.height
        }))
      }
    });

  } catch (error) {
    console.error('Spotify artist error:', error);
    return res.status(500).json({ error: 'Failed to fetch artist data' });
  }
}

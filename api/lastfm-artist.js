// Last.fm Artist Image Endpoint
// Fetches artist images from Last.fm API

const LASTFM_API_KEY = 'd3f4facf02b4045ad1158dff7b3e813a';
const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';

export default async function handler(req, res) {
  const { artist } = req.query;
  
  if (!artist) {
    return res.status(400).json({ error: 'Artist parameter required' });
  }
  
  console.log('[Last.fm] Fetching artist:', artist);
  
  try {
    const url = `${LASTFM_API_URL}?method=artist.getinfo&artist=${encodeURIComponent(artist)}&api_key=${LASTFM_API_KEY}&format=json`;
    console.log('[Last.fm] Request URL:', url);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      console.error('[Last.fm] API returned:', response.status);
      throw new Error(`Last.fm API returned ${response.status}`);
    }
    
    const data = await response.json();
    console.log('[Last.fm] Response:', JSON.stringify(data).substring(0, 200));
    
    if (data.error) {
      console.error('[Last.fm] Error:', data.message);
      return res.status(404).json({ error: data.message });
    }
    
    // Extract image URL (prefer extralarge, fallback to large)
    const images = data.artist?.image || [];
    const imageUrl = images.find(img => img.size === 'extralarge')?.['#text'] ||
                     images.find(img => img.size === 'large')?.['#text'] ||
                     images.find(img => img.size === 'medium')?.['#text'] ||
                     null;
    
    console.log('[Last.fm] Image URL:', imageUrl);
    
    // Cache for 24 hours
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');
    
    return res.status(200).json({
      artist: data.artist?.name,
      image: imageUrl,
      listeners: data.artist?.stats?.listeners,
      playcount: data.artist?.stats?.playcount
    });
    
  } catch (error) {
    console.error('[Last.fm] Error:', error.message);
    return res.status(500).json({ error: 'Failed to fetch artist info' });
  }
}

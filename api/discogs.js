// Vercel Serverless Function for Discogs API
// This runs on the server, so no CORS issues!

export default async function handler(req, res) {
  // Only allow GET requests
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { q } = req.query;

  // Validate search query
  if (!q || q.trim() === '') {
    return res.status(400).json({ error: 'Search query required' });
  }

  try {
    // Call Discogs API with authentication
    const discogsUrl = `https://api.discogs.com/database/search?q=${encodeURIComponent(q)}&type=release&format=vinyl&per_page=20&key=${process.env.DISCOGS_CONSUMER_KEY}&secret=${process.env.DISCOGS_CONSUMER_SECRET}`;

    const response = await fetch(discogsUrl, {
      headers: {
        'User-Agent': 'Findyl/1.0 +https://findyl.co.uk',
      },
    });

    if (!response.ok) {
      throw new Error(`Discogs API error: ${response.status}`);
    }

    const data = await response.json();

    // Return results to frontend
    return res.status(200).json({
      results: data.results || [],
      pagination: data.pagination || {},
    });

  } catch (error) {
    console.error('Discogs API error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch vinyl records',
      message: error.message 
    });
  }
}

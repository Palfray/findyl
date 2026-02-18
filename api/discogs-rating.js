export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const { artist, album } = req.query;
    if (!artist || !album) return res.status(400).json({ error: 'Missing params' });

    const DISCOGS_TOKEN = 'FxYsHceDMwTEZvpzsKuPdyJdfjoMwkPiDBEeTCSy';
    const headers = {
        'Authorization': `Discogs token=${DISCOGS_TOKEN}`,
        'User-Agent': 'findyl/1.0 (https://findyl.co.uk)'
    };

    try {
        // Search for the release
        const url = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&per_page=5`;
        const searchRes = await fetch(url, { headers });
        const searchData = await searchRes.json();

        if (!searchData.results?.length) {
            return res.status(404).json({ error: 'Not found' });
        }

        // Find best result - prefer master type, then highest community_want
        const results = searchData.results;
        const masters = results.filter(r => r.type === 'master');
        const best = masters.length > 0 ? masters[0] : results[0];

        // Use community_score from search results directly
        const masterId = best.master_id;
        if (!masterId) return res.status(404).json({ error: 'No master ID' });

        const masterRes = await fetch(`https://api.discogs.com/masters/${masterId}`, { headers });
        const master = await masterRes.json();

        // Log for debugging
        console.log('Master:', master.title, 'Artist:', master.artists?.[0]?.name, 'Community:', JSON.stringify(master.community));

        const community = master.community || {};
        const rating = community.rating?.average;
        const count = community.rating?.count || 0;
        const have = community.have || 0;
        const want = community.want || 0;

        if (!rating || count < 1) {
            return res.status(404).json({ 
                error: 'No ratings', 
                debug: { title: master.title, artist: master.artists?.[0]?.name, count, rating }
            });
        }

        return res.status(200).json({ rating: parseFloat(rating.toFixed(2)), count, have, want });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const { artist, album } = req.query;
    if (!artist || !album) return res.status(400).json({ error: 'Missing artist or album' });

    const DISCOGS_TOKEN = 'FxYsHceDMwTEZvpzsKuPdyJdfjoMwkPiDBEeTCSy';
    const headers = {
        'Authorization': `Discogs token=${DISCOGS_TOKEN}`,
        'User-Agent': 'findyl/1.0 (https://findyl.co.uk)'
    };

    try {
        // Try multiple search strategies
        const searches = [
            `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&type=master&per_page=3`,
            `https://api.discogs.com/database/search?q=${encodeURIComponent(artist + ' ' + album)}&type=master&per_page=3`,
        ];

        let masterId = null;

        for (const url of searches) {
            const searchRes = await fetch(url, { headers });
            const searchData = await searchRes.json();
            
            if (searchData.results && searchData.results.length > 0) {
                masterId = searchData.results[0].master_id || searchData.results[0].id;
                if (masterId) break;
            }
        }

        if (!masterId) return res.status(404).json({ error: 'Not found' });

        // Get master details
        const masterRes = await fetch(`https://api.discogs.com/masters/${masterId}`, { headers });
        const master = await masterRes.json();

        const community = master.community || {};
        const rating = community.rating?.average;
        const count = community.rating?.count;

        if (!rating || count < 5) return res.status(404).json({ error: 'Insufficient ratings' });

        return res.status(200).json({
            rating: parseFloat(rating.toFixed(2)),
            count,
            have: community.have || 0,
            want: community.want || 0
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

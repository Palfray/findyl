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
        // Search for master release
        const query = encodeURIComponent(`${artist} ${album}`);
        const searchRes = await fetch(
            `https://api.discogs.com/database/search?q=${query}&type=master&format=vinyl&per_page=1`,
            { headers }
        );
        const searchData = await searchRes.json();

        if (!searchData.results || searchData.results.length === 0) {
            return res.status(404).json({ error: 'Not found' });
        }

        const masterId = searchData.results[0].master_id || searchData.results[0].id;
        if (!masterId) return res.status(404).json({ error: 'No master ID' });

        // Get master details
        const masterRes = await fetch(`https://api.discogs.com/masters/${masterId}`, { headers });
        const master = await masterRes.json();

        const community = master.community || {};
        const rating = community.rating?.average;
        const count = community.rating?.count;

        if (!rating || count < 5) return res.status(404).json({ error: 'Insufficient ratings' });

        return res.status(200).json({
            rating: parseFloat((rating / 2).toFixed(2)),
            count,
            have: community.have || 0,
            want: community.want || 0
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

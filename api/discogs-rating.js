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
        const url = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&per_page=5`;
        const searchRes = await fetch(url, { headers });
        const searchData = await searchRes.json();

        if (!searchData.results?.length) {
            return res.status(404).json({ error: 'Not found' });
        }

        // Return debug info about what we found
        return res.status(200).json({
            debug: searchData.results.map(r => ({
                type: r.type,
                title: r.title,
                year: r.year,
                master_id: r.master_id,
                id: r.id,
                community: r.community,
                have: r.community?.have,
                want: r.community?.want
            }))
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

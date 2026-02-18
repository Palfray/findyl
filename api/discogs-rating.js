export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    const { artist, album, mbid } = req.query;
    if (!artist || !album) return res.status(400).json({ error: 'Missing params' });

    const DISCOGS_TOKEN = 'FxYsHceDMwTEZvpzsKuPdyJdfjoMwkPiDBEeTCSy';
    const headers = {
        'Authorization': `Discogs token=${DISCOGS_TOKEN}`,
        'User-Agent': 'findyl/1.0 (https://findyl.co.uk)'
    };

    try {
        let masterId = null;

        // Strategy 1: Search by MBID if provided (most accurate)
        if (mbid) {
            const mbidRes = await fetch(
                `https://api.discogs.com/database/search?q=${mbid}&type=master&per_page=1`,
                { headers }
            );
            const mbidData = await mbidRes.json();
            if (mbidData.results?.length > 0) {
                masterId = mbidData.results[0].master_id || mbidData.results[0].id;
            }
        }

        // Strategy 2: Search by artist + title
        if (!masterId) {
            const url = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&type=master&per_page=5`;
            const searchRes = await fetch(url, { headers });
            const searchData = await searchRes.json();

            if (searchData.results?.length > 0) {
                // Pick result whose title most closely matches
                const albumLower = album.toLowerCase();
                const best = searchData.results.find(r => 
                    r.title?.toLowerCase().includes(albumLower) || 
                    albumLower.includes(r.title?.toLowerCase())
                ) || searchData.results[0];
                masterId = best.master_id || best.id;
            }
        }

        if (!masterId) return res.status(404).json({ error: 'Not found' });

        // Get master details
        const masterRes = await fetch(`https://api.discogs.com/masters/${masterId}`, { headers });
        const master = await masterRes.json();

        // Verify this is the right artist
        const masterArtist = master.artists?.[0]?.name?.toLowerCase() || '';
        const queryArtist = artist.toLowerCase();
        if (masterArtist && !masterArtist.includes(queryArtist) && !queryArtist.includes(masterArtist)) {
            return res.status(404).json({ error: 'Artist mismatch', found: master.artists?.[0]?.name });
        }

        const community = master.community || {};
        const rating = community.rating?.average;
        const count = community.rating?.count || 0;

        if (!rating || count < 3) return res.status(404).json({ error: 'Insufficient ratings', count });

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

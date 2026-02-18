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
        // Search by artist + title separately for best matching
        const url = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&type=master&per_page=5`;
        const searchRes = await fetch(url, { headers });
        const searchData = await searchRes.json();

        if (!searchData.results || searchData.results.length === 0) {
            // Fallback to combined query
            const url2 = `https://api.discogs.com/database/search?q=${encodeURIComponent(artist + ' ' + album)}&type=master&per_page=5`;
            const searchRes2 = await fetch(url2, { headers });
            const searchData2 = await searchRes2.json();
            if (!searchData2.results || searchData2.results.length === 0) {
                return res.status(404).json({ error: 'Not found' });
            }
            searchData.results = searchData2.results;
        }

        // Pick the result with the most community votes
        let bestMasterId = null;
        let bestCount = 0;
        let bestRating = null;
        let bestHave = 0;
        let bestWant = 0;

        for (const result of searchData.results) {
            const mid = result.master_id || result.id;
            if (!mid) continue;

            const masterRes = await fetch(`https://api.discogs.com/masters/${mid}`, { headers });
            const master = await masterRes.json();
            const community = master.community || {};
            const count = community.rating?.count || 0;

            if (count > bestCount) {
                bestCount = count;
                bestMasterId = mid;
                bestRating = community.rating?.average;
                bestHave = community.have || 0;
                bestWant = community.want || 0;
            }
        }

        if (!bestRating || bestCount < 3) {
            return res.status(404).json({ error: 'Insufficient ratings', count: bestCount });
        }

        return res.status(200).json({
            rating: parseFloat(bestRating.toFixed(2)),
            count: bestCount,
            have: bestHave,
            want: bestWant
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

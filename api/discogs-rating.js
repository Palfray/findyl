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
        // Search for releases
        const url = `https://api.discogs.com/database/search?artist=${encodeURIComponent(artist)}&release_title=${encodeURIComponent(album)}&per_page=5`;
        const searchRes = await fetch(url, { headers });
        const searchData = await searchRes.json();

        if (!searchData.results?.length) {
            return res.status(404).json({ error: 'Not found' });
        }

        // Find the master_id with the most have+want (most popular)
        let bestMasterId = null;
        let bestScore = 0;
        let bestHave = 0;
        let bestWant = 0;

        for (const r of searchData.results) {
            const mid = r.master_id;
            if (!mid) continue;
            const score = (r.community?.have || 0) + (r.community?.want || 0);
            if (score > bestScore) {
                bestScore = score;
                bestMasterId = mid;
                bestHave = r.community?.have || 0;
                bestWant = r.community?.want || 0;
            }
        }

        if (!bestMasterId) return res.status(404).json({ error: 'No master found' });

        // Fetch the master for the rating
        const masterRes = await fetch(`https://api.discogs.com/masters/${bestMasterId}`, { headers });
        const master = await masterRes.json();

        const rating = master.community?.rating?.average;
        const count = master.community?.rating?.count || 0;

        // Aggregate have/want across all matching results for this master
        let totalHave = 0;
        let totalWant = 0;
        for (const r of searchData.results) {
            if (r.master_id === bestMasterId) {
                totalHave += r.community?.have || 0;
                totalWant += r.community?.want || 0;
            }
        }

        if (!rating || count < 3) {
            return res.status(404).json({ error: 'No ratings', count, rating });
        }

        return res.status(200).json({
            rating: parseFloat(rating.toFixed(2)),
            count,
            have: totalHave || bestHave,
            want: totalWant || bestWant
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

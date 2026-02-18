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

        // Find release (not master) with most have+want
        const releases = searchData.results.filter(r => r.type === 'release');
        if (!releases.length) return res.status(404).json({ error: 'No releases found' });

        releases.sort((a, b) => 
            ((b.community?.have || 0) + (b.community?.want || 0)) - 
            ((a.community?.have || 0) + (a.community?.want || 0))
        );

        const best = releases[0];

        // Fetch the release for rating
        const releaseRes = await fetch(`https://api.discogs.com/releases/${best.id}`, { headers });
        const release = await releaseRes.json();

        const rating = release.community?.rating?.average;
        const count = release.community?.rating?.count || 0;

        // Aggregate have/want across all results for this master
        const masterId = best.master_id;
        let totalHave = 0, totalWant = 0;
        for (const r of searchData.results) {
            if (r.master_id === masterId) {
                totalHave += r.community?.have || 0;
                totalWant += r.community?.want || 0;
            }
        }

        if (!rating || count < 3) {
            return res.status(404).json({ error: 'No ratings', debug: { releaseId: best.id, count, rating } });
        }

        return res.status(200).json({
            rating: parseFloat(rating.toFixed(1)),
            count,
            have: totalHave,
            want: totalWant
        });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

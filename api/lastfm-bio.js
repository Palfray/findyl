const LASTFM_API_KEY = '30e9f644aae15dcd15f388eabc60adba';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate');

    const { artist } = req.query;
    if (!artist) return res.status(400).json({ error: 'Artist required' });

    try {
        const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artist)}&api_key=${LASTFM_API_KEY}&format=json&lang=en`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.error || !data.artist) {
            return res.status(404).json({ error: 'Artist not found' });
        }

        // Get bio summary and strip Last.fm self-promotional links
        let bio = data.artist?.bio?.summary || '';
        bio = bio.replace(/<a href="https:\/\/www\.last\.fm[^"]*"[^>]*>Read more on Last\.fm<\/a>/gi, '').trim();
        bio = bio.replace(/<[^>]+>/g, '').trim(); // strip any remaining HTML tags
        bio = bio.replace(/\s+/g, ' ').trim();

        if (!bio) return res.status(404).json({ error: 'No bio available' });

        return res.status(200).json({ bio });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}

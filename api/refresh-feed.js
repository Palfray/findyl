import { Redis } from '@upstash/redis';
import { createGunzip } from 'zlib';
import { Readable } from 'stream';

export const config = {
  maxDuration: 60,
};

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Correct feed ID mapping (confirmed via feed-debug):
// 43053  = EMP (65k products, category "LP" for vinyl, brand_name = real artist)
// 98984  = VinylCastle (83k products, category "Vinyl" for records, brand_name = "1" useless)
// 108054 = POPSTORE (770 products, category "855" numeric, brand_name = EAN barcode)

const COLUMNS = 'aw_deep_link,product_name,search_price,merchant_name,merchant_category,merchant_image_url,aw_image_url,brand_name,in_stock,ean,colour,merchant_deep_link,currency';

function buildFeedUrl(apiKey, feedId) {
  return `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/language/en/fid/${feedId}/rid/0/hasEnhancedFeeds/0/columns/${COLUMNS}/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/`;
}

function parseCSVLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

async function fetchAndProcess(apiKey, feedId, label, filterFn) {
  const url = buildFeedUrl(apiKey, feedId);
  console.log(`📥 ${label} (ID: ${feedId})...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!response.ok) throw new Error(`${label}: AWIN returned ${response.status}`);

  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(response.body);

  return new Promise((resolve, reject) => {
    const results = [];
    let headers = [];
    let buffer = '';
    let headerParsed = false;
    let totalRows = 0;

    nodeStream.pipe(gunzip);

    gunzip.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, newlineIdx).trim();
        buffer = buffer.substring(newlineIdx + 1);
        if (!line) continue;
        if (!headerParsed) {
          headers = parseCSVLine(line);
          headerParsed = true;
          continue;
        }
        totalRows++;
        const values = parseCSVLine(line);
        if (values.length !== headers.length) continue;

        const inStockIdx = headers.indexOf('in_stock');
        if (inStockIdx >= 0 && values[inStockIdx] !== '1') continue;

        const row = {};
        for (let i = 0; i < headers.length; i++) {
          row[headers[i].trim()] = values[i] || '';
        }
        const result = filterFn(row);
        if (result) results.push(result);
      }
    });

    gunzip.on('end', () => {
      if (buffer.trim() && headerParsed) {
        const values = parseCSVLine(buffer.trim());
        if (values.length === headers.length) {
          const inStockIdx = headers.indexOf('in_stock');
          if (inStockIdx < 0 || values[inStockIdx] === '1') {
            const row = {};
            for (let i = 0; i < headers.length; i++) {
              row[headers[i].trim()] = values[i] || '';
            }
            const result = filterFn(row);
            if (result) results.push(result);
          }
        }
      }
      console.log(`📊 ${label}: ${totalRows} rows → ${results.length} products`);
      resolve(results);
    });

    gunzip.on('error', (err) => reject(new Error(`${label} gunzip: ${err.message}`)));
    nodeStream.on('error', (err) => reject(new Error(`${label} stream: ${err.message}`)));
  });
}

// --- EMP (feed 43053): category "LP", brand_name = real artist ---
function empFilter(r) {
  if (r.merchant_category !== 'LP') return null;

  const artist = (r.brand_name || '').trim();
  const productName = (r.product_name || '').trim();

  // Derive album from product name
  let album = productName;
  // Strip artist prefix if present
  if (artist && album.toLowerCase().startsWith(artist.toLowerCase())) {
    album = album.substring(artist.length).trim();
    album = album.replace(/^[\s\-–—]+/, '').trim();
  }
  // Remove "LP", "LP [colour]", "2LP", format keywords
  album = album
    .replace(/\b\d*LP\b.*$/i, '')
    .replace(/\b(vinyl|gatefold|reissue|remaster|deluxe|limited|edition|coloured|colored|heavyweight|clear|red|blue|green|white|black|yellow|orange|pink|purple|marble|splatter)\b.*$/gi, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[\s\-–—]+$/, '')
    .trim();

  if (!artist || !album) return null;

  return {
    artist, album, title: productName,
    price: parseFloat(r.search_price) || 0,
    link: r.aw_deep_link || '',
    image: r.merchant_image_url || r.aw_image_url || '',
    ean: r.ean || '', in_stock: true, colour: r.colour || '',
    product_name: productName
  };
}

// --- VinylCastle (feed 98984): category "Vinyl", brand_name useless ("1") ---
// Product names follow "Artist - Album" pattern OR just album titles
function vcFilter(r) {
  if (r.merchant_category !== 'Vinyl') return null;

  const productName = (r.product_name || '').trim();
  let artist = '', album = '';

  // Parse "Artist - Album, Format" from product name
  const dashSplit = productName.split(' - ');
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim();
    album = dashSplit.slice(1).join(' - ').trim();
  }

  // Clean album: remove format suffixes
  album = album
    .replace(/,\s*(vinyl|lp|2xlp|3xlp|heavyweight|gatefold|coloured|colored|limited|clear|180g|180 gram).*$/i, '')
    .replace(/\b(vinyl|lp|2xlp|3xlp|12"|7"|10")\b.*$/gi, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[\s\-–—,]+$/, '')
    .trim();

  if (!artist || !album) return null;

  const price = parseFloat(r.search_price) || 0;
  if (price <= 0) return null;

  return {
    artist, album, price, currency: r.currency || 'GBP',
    link: r.aw_deep_link || '',
    image: r.merchant_image_url || r.aw_image_url || '',
    availability: 'In Stock', ean: r.ean || '', product_name: productName
  };
}

// --- POPSTORE (feed 108054): category "855" (numeric), brand_name = EAN barcode ---
// Product names: "Artist - Album, Format Lp" or "Artist - Album, Gatefold Vinyl Lp"
function popFilter(r) {
  const productName = (r.product_name || '').trim();
  const nameLower = productName.toLowerCase();

  // POPSTORE is almost all vinyl but filter to be safe
  const isVinyl = nameLower.includes('lp') || nameLower.includes('vinyl') ||
    r.merchant_category === '855';
  if (!isVinyl) return null;

  let artist = '', album = '';
  const dashSplit = productName.split(' - ');
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim();
    album = dashSplit.slice(1).join(' - ').trim();
  }

  // Clean album: remove ", Heavyweight Vinyl 2xlp" etc
  album = album
    .replace(/,\s*(heavyweight|gatefold|coloured|colored|limited|clear|180g|lp|vinyl|2xlp|3xlp).*$/i, '')
    .replace(/\b(vinyl|lp|2xlp|3xlp|gatefold|coloured|colored|limited|edition|deluxe|heavyweight)\b.*$/gi, '')
    .replace(/\(.*?\)/g, '')
    .trim()
    .replace(/[\s\-–—,]+$/, '')
    .trim();

  if (!artist || !album) return null;

  const price = parseFloat(r.search_price) || 0;
  if (price <= 0) return null;

  // Use brand_name as EAN if it looks like one (all digits)
  const ean = /^\d+$/.test(r.brand_name || '') ? r.brand_name : (r.ean || '');

  return {
    artist, album, title: productName, price,
    link: r.aw_deep_link || '',
    image: r.merchant_image_url || r.aw_image_url || '',
    availability: 'In Stock', ean,
    product_name: productName,
    url: r.merchant_deep_link || r.aw_deep_link || ''
  };
}

export default async function handler(req, res) {
  const isManual = req.query.key === process.env.AWIN_API_KEY;
  if (!isManual && !req.headers['x-vercel-cron'] && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('⚠️ No auth, proceeding');
  }

  const apiKey = process.env.AWIN_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AWIN_API_KEY not configured' });

  const counts = {};

  try {
    // --- EMP (feed 43053) ---
    try {
      const products = await fetchAndProcess(apiKey, '43053', 'EMP', empFilter);
      counts.emp = products.length;
      await redis.set('feed:emp', JSON.stringify(products));
      console.log('✅ EMP stored');
    } catch (e) {
      console.error('❌ EMP:', e.message);
      counts.emp = 'error';
    }

    // --- POPSTORE (feed 108054) ---
    try {
      const products = await fetchAndProcess(apiKey, '108054', 'POPSTORE', popFilter);
      counts.popstore = products.length;
      await redis.set('feed:popstore', JSON.stringify(products));
      console.log('✅ POPSTORE stored');
    } catch (e) {
      console.error('❌ POPSTORE:', e.message);
      counts.popstore = 'error';
    }

    // --- VinylCastle (feed 98984) ---
    try {
      const products = await fetchAndProcess(apiKey, '98984', 'VinylCastle', vcFilter);
      counts.vinylcastle = products.length;
      const CHUNK = 5000;
      const numChunks = Math.ceil(products.length / CHUNK);
      await redis.set('feed:vc:meta', JSON.stringify({ chunks: numChunks, total: products.length }));
      for (let i = 0; i < numChunks; i++) {
        await redis.set(`feed:vc:${i}`, JSON.stringify(products.slice(i * CHUNK, (i + 1) * CHUNK)));
      }
      console.log(`✅ VC stored (${numChunks} chunks)`);
    } catch (e) {
      console.error('❌ VC:', e.message);
      counts.vinylcastle = 'error';
    }

    const ts = new Date().toISOString();
    await redis.set('feed:updated', ts);
    return res.status(200).json({ success: true, updated: ts, counts });

  } catch (error) {
    console.error('❌ Fatal:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

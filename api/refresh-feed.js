import { Redis } from '@upstash/redis';

export const config = {
  maxDuration: 60,
};

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Minimal columns only
const COLUMNS = 'aw_deep_link,product_name,search_price,merchant_name,merchant_category,merchant_image_url,aw_image_url,brand_name,in_stock,ean,colour,merchant_deep_link,currency';

function buildFeedUrl(apiKey, feedId) {
  // NO compression — request plain CSV to avoid memory spike from decompressing
  return `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/language/en/fid/${feedId}/rid/0/hasEnhancedFeeds/0/columns/${COLUMNS}/format/csv/delimiter/%2C/compression/0/adultcontent/1/`;
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

// Stream-parse CSV text into rows, processing only in-stock items to save memory
function parseAndFilter(csvText, filterFn) {
  const results = [];
  let headerLine = '';
  let headers = [];
  let pos = 0;

  // Find header line
  const firstNewline = csvText.indexOf('\n');
  if (firstNewline === -1) return results;
  headerLine = csvText.substring(0, firstNewline);
  headers = parseCSVLine(headerLine);
  pos = firstNewline + 1;

  // Process line by line
  while (pos < csvText.length) {
    const nextNewline = csvText.indexOf('\n', pos);
    const lineEnd = nextNewline === -1 ? csvText.length : nextNewline;
    const line = csvText.substring(pos, lineEnd).trim();
    pos = lineEnd + 1;

    if (!line) continue;

    const values = parseCSVLine(line);
    if (values.length !== headers.length) continue;

    // Quick check: skip out of stock before building object
    const inStockIdx = headers.indexOf('in_stock');
    if (inStockIdx >= 0 && values[inStockIdx] !== '1') continue;

    const row = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i].trim()] = values[i] || '';
    }

    const result = filterFn(row);
    if (result) results.push(result);
  }

  return results;
}

// --- EMP filter ---
function empFilter(r) {
  if (r.merchant_category !== 'LP') return null;
  const artist = (r.brand_name || '').trim();
  const productName = (r.product_name || '').trim();
  let album = productName;
  if (artist && album.toLowerCase().startsWith(artist.toLowerCase())) {
    album = album.substring(artist.length).trim();
  }
  album = album.replace(/\b\d*LP\b.*$/i, '').replace(/\b(vinyl|gatefold|reissue|remaster|deluxe|limited|edition)\b.*$/gi, '').trim().replace(/[\s\-–—]+$/, '').trim();
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

// --- VinylCastle filter ---
function vcFilter(r) {
  const productName = (r.product_name || '').trim();
  const brandName = (r.brand_name || '').trim();
  let artist = '', album = '';
  const dashSplit = productName.split(' - ');
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim();
    album = dashSplit.slice(1).join(' - ').trim();
  } else if (brandName) {
    artist = brandName;
    album = productName;
    if (album.toLowerCase().startsWith(artist.toLowerCase())) {
      album = album.substring(artist.length).trim().replace(/^[\s\-–—]+/, '').trim();
    }
  }
  album = album.replace(/\b(vinyl|lp|2xlp|3xlp|12"|7"|10")\b.*$/gi, '').replace(/\(.*?\)/g, '').trim().replace(/[\s\-–—]+$/, '').trim();
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

// --- POPSTORE filter ---
function popFilter(r) {
  const name = (r.product_name || '').toLowerCase();
  const cat = (r.merchant_category || '').toLowerCase();
  const isVinyl = cat.includes('vinyl') || cat.includes('lp') || cat === 'records' ||
    name.includes('vinyl') || name.includes(' lp');
  if (!isVinyl) return null;

  const productName = (r.product_name || '').trim();
  const brandName = (r.brand_name || '').trim();
  let artist = '', album = '';
  const dashSplit = productName.split(' - ');
  if (dashSplit.length >= 2) {
    artist = dashSplit[0].trim();
    album = dashSplit.slice(1).join(' - ').trim();
  } else if (brandName) {
    artist = brandName;
    album = productName;
  }
  album = album.replace(/,\s*(vinyl|lp).*$/i, '').replace(/\b(vinyl|lp|2xlp|3xlp|gatefold|coloured|colored|limited|edition|deluxe)\b.*$/gi, '').replace(/\(.*?\)/g, '').trim().replace(/[\s\-–—]+$/, '').trim();
  if (!artist || !album) return null;
  const price = parseFloat(r.search_price) || 0;
  if (price <= 0) return null;
  return {
    artist, album, title: productName, price,
    link: r.aw_deep_link || '',
    image: r.merchant_image_url || r.aw_image_url || '',
    availability: 'In Stock', ean: r.ean || '',
    product_name: productName,
    url: r.merchant_deep_link || r.aw_deep_link || ''
  };
}

async function fetchFeed(apiKey, feedId, label) {
  const url = buildFeedUrl(apiKey, feedId);
  console.log(`📥 Fetching ${label} (ID: ${feedId})...`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  if (!response.ok) throw new Error(`${label}: AWIN returned ${response.status}`);
  const text = await response.text();
  console.log(`📦 ${label}: ${(text.length / 1024 / 1024).toFixed(1)} MB`);
  return text;
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
    // --- EMP (feed 98984) — smallest feed, ~65k rows, ~3k vinyl ---
    try {
      const csv = await fetchFeed(apiKey, '98984', 'EMP');
      const products = parseAndFilter(csv, empFilter);
      counts.emp = products.length;
      console.log(`🏪 EMP: ${products.length} vinyl`);
      await redis.set('feed:emp', JSON.stringify(products));
      console.log('✅ EMP stored');
    } catch (e) {
      console.error('❌ EMP:', e.message);
      counts.emp = 'error';
    }

    // --- POPSTORE (feed 108054) — large feed but few vinyl products ---
    try {
      const csv = await fetchFeed(apiKey, '108054', 'POPSTORE');
      const products = parseAndFilter(csv, popFilter);
      counts.popstore = products.length;
      console.log(`🏪 POPSTORE: ${products.length} vinyl`);
      await redis.set('feed:popstore', JSON.stringify(products));
      console.log('✅ POPSTORE stored');
    } catch (e) {
      console.error('❌ POPSTORE:', e.message);
      counts.popstore = 'error';
    }

    // --- VinylCastle (feed 43053) ---
    try {
      const csv = await fetchFeed(apiKey, '43053', 'VinylCastle');
      const products = parseAndFilter(csv, vcFilter);
      counts.vinylcastle = products.length;
      console.log(`🏪 VC: ${products.length} vinyl`);
      const CHUNK = 5000;
      const chunks = Math.ceil(products.length / CHUNK);
      await redis.set('feed:vc:meta', JSON.stringify({ chunks, total: products.length }));
      for (let i = 0; i < chunks; i++) {
        await redis.set(`feed:vc:${i}`, JSON.stringify(products.slice(i * CHUNK, (i + 1) * CHUNK)));
      }
      console.log(`✅ VC stored (${chunks} chunks)`);
    } catch (e) {
      console.error('❌ VC:', e.message);
      counts.vinylcastle = 'error';
    }

    const ts = new Date().toISOString();
    await redis.set('feed:updated', ts);
    console.log(`✅ Done at ${ts}`);
    return res.status(200).json({ success: true, updated: ts, counts });

  } catch (error) {
    console.error('❌ Fatal:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

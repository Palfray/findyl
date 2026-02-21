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

// Stream-decompress and parse CSV, filtering as we go
// debugCategories: if true, collect unique category values for logging
async function fetchAndProcess(apiKey, feedId, label, filterFn, debugCategories = false) {
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
    const categories = debugCategories ? new Map() : null;

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

        // Debug: collect categories
        if (categories) {
          const catIdx = headers.indexOf('merchant_category');
          if (catIdx >= 0) {
            const cat = values[catIdx] || '(empty)';
            categories.set(cat, (categories.get(cat) || 0) + 1);
          }
        }

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
      if (categories) {
        // Log top 20 categories
        const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
        console.log(`📋 ${label} categories:`, JSON.stringify(sorted));
      }
      resolve(results);
    });

    gunzip.on('error', (err) => reject(new Error(`${label} gunzip: ${err.message}`)));
    nodeStream.on('error', (err) => reject(new Error(`${label} stream: ${err.message}`)));
  });
}

// --- EMP: accept LP in any case, also check product_name for "LP" ---
function empFilter(r) {
  const cat = (r.merchant_category || '').trim();
  const name = (r.product_name || '').toLowerCase();

  // Accept if category is LP (case-insensitive) OR product name contains " LP"
  const isLP = cat.toLowerCase() === 'lp' || name.includes(' lp');
  if (!isLP) return null;

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

// --- VinylCastle: only accept vinyl/LP products ---
function vcFilter(r) {
  const productName = (r.product_name || '').trim();
  const nameLower = productName.toLowerCase();
  const cat = (r.merchant_category || '').toLowerCase();

  // VinylCastle filter: must look like a vinyl product
  const isVinyl = cat.includes('vinyl') || cat.includes('lp') || cat.includes('record') ||
    nameLower.includes('vinyl') || nameLower.includes(' lp') ||
    nameLower.includes(' lp,') || nameLower.includes(' lp ') ||
    /\bLP\b/.test(r.product_name || '');
  if (!isVinyl) return null;

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

// --- POPSTORE ---
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

export default async function handler(req, res) {
  const isManual = req.query.key === process.env.AWIN_API_KEY;
  if (!isManual && !req.headers['x-vercel-cron'] && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('⚠️ No auth, proceeding');
  }

  const apiKey = process.env.AWIN_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AWIN_API_KEY not configured' });

  const counts = {};

  try {
    // EMP — enable debug categories to see what values exist
    try {
      const products = await fetchAndProcess(apiKey, '98984', 'EMP', empFilter, true);
      counts.emp = products.length;
      await redis.set('feed:emp', JSON.stringify(products));
      console.log('✅ EMP stored');
    } catch (e) {
      console.error('❌ EMP:', e.message);
      counts.emp = 'error';
    }

    // POPSTORE
    try {
      const products = await fetchAndProcess(apiKey, '108054', 'POPSTORE', popFilter);
      counts.popstore = products.length;
      await redis.set('feed:popstore', JSON.stringify(products));
      console.log('✅ POPSTORE stored');
    } catch (e) {
      console.error('❌ POPSTORE:', e.message);
      counts.popstore = 'error';
    }

    // VinylCastle — enable debug categories
    try {
      const products = await fetchAndProcess(apiKey, '43053', 'VinylCastle', vcFilter, true);
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

import { Redis } from '@upstash/redis';
import { gunzipSync } from 'zlib';

export const config = {
  maxDuration: 60,
};

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Only request columns we actually use — massively reduces download size
const COLUMNS = 'aw_deep_link,product_name,search_price,merchant_name,merchant_category,merchant_image_url,aw_image_url,brand_name,in_stock,ean,colour,merchant_deep_link,currency,description,merchant_product_category_path';

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

function parseCSV(csvText) {
  const lines = csvText.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h.trim()] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

async function fetchAndParse(apiKey, feedId, label) {
  const url = buildFeedUrl(apiKey, feedId);
  console.log(`📥 Fetching ${label} feed (ID: ${feedId})...`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  const response = await fetch(url, { signal: controller.signal });
  clearTimeout(timeoutId);
  if (!response.ok) throw new Error(`${label}: AWIN returned ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  console.log(`📦 ${label}: Downloaded ${(buffer.length / 1024).toFixed(0)} KB`);
  const csvText = gunzipSync(buffer).toString('utf-8');
  const rows = parseCSV(csvText);
  console.log(`📊 ${label}: ${rows.length} total rows`);
  return rows;
}

function processEMP(rows) {
  return rows.filter(r => r.merchant_category === 'LP' && r.in_stock === '1').map(r => {
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
  }).filter(Boolean);
}

function processVinylCastle(rows) {
  return rows.filter(r => r.in_stock === '1').map(r => {
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
  }).filter(Boolean);
}

function processPOPSTORE(rows) {
  const vinylRows = rows.filter(r => {
    if (r.in_stock !== '1') return false;
    const name = (r.product_name || '').toLowerCase();
    const cat = (r.merchant_category || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const catPath = (r.merchant_product_category_path || '').toLowerCase();
    return (
      cat.includes('vinyl') || cat.includes('lp') || cat === 'records' ||
      catPath.includes('vinyl') || catPath.includes('records') ||
      name.includes('vinyl') || name.includes(' lp') ||
      desc.includes('vinyl') || desc.includes('gramophone') ||
      desc.includes('12-inch') || desc.includes('33rpm')
    );
  });
  return vinylRows.map(r => {
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
  }).filter(Boolean);
}

export default async function handler(req, res) {
  const isManual = req.query.key === process.env.AWIN_API_KEY;
  if (!isManual && !req.headers['x-vercel-cron'] && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    console.log('⚠️ No auth, proceeding (Vercel hobby cron)');
  }

  const apiKey = process.env.AWIN_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'AWIN_API_KEY not configured' });

  const counts = {};

  try {
    // Process each feed SEPARATELY to stay within memory limits

    // --- EMP (feed ID 98984) ---
    try {
      const empRows = await fetchAndParse(apiKey, '98984', 'EMP');
      const empProducts = processEMP(empRows);
      counts.emp = empProducts.length;
      console.log(`🏪 EMP: ${empProducts.length} vinyl products`);
      await redis.set('feed:emp', JSON.stringify(empProducts));
      console.log('✅ Stored EMP');
    } catch (e) {
      console.error('❌ EMP failed:', e.message);
      counts.emp = 'error';
    }

    // --- POPSTORE (feed ID 108054) ---
    try {
      const popRows = await fetchAndParse(apiKey, '108054', 'POPSTORE');
      const popProducts = processPOPSTORE(popRows);
      counts.popstore = popProducts.length;
      console.log(`🏪 POPSTORE: ${popProducts.length} vinyl products`);
      await redis.set('feed:popstore', JSON.stringify(popProducts));
      console.log('✅ Stored POPSTORE');
    } catch (e) {
      console.error('❌ POPSTORE failed:', e.message);
      counts.popstore = 'error';
    }

    // --- VinylCastle (feed ID 43053) ---
    try {
      const vcRows = await fetchAndParse(apiKey, '43053', 'VinylCastle');
      const vcProducts = processVinylCastle(vcRows);
      counts.vinylcastle = vcProducts.length;
      console.log(`🏪 VinylCastle: ${vcProducts.length} vinyl products`);
      const VC_CHUNK_SIZE = 5000;
      const vcChunks = [];
      for (let i = 0; i < vcProducts.length; i += VC_CHUNK_SIZE) {
        vcChunks.push(vcProducts.slice(i, i + VC_CHUNK_SIZE));
      }
      await redis.set('feed:vc:meta', JSON.stringify({ chunks: vcChunks.length, total: vcProducts.length }));
      for (let i = 0; i < vcChunks.length; i++) {
        await redis.set(`feed:vc:${i}`, JSON.stringify(vcChunks[i]));
      }
      console.log(`✅ Stored VinylCastle (${vcChunks.length} chunks)`);
    } catch (e) {
      console.error('❌ VinylCastle failed:', e.message);
      counts.vinylcastle = 'error';
    }

    const timestamp = new Date().toISOString();
    await redis.set('feed:updated', timestamp);
    console.log(`✅ Feed refresh complete at ${timestamp}`);
    return res.status(200).json({ success: true, updated: timestamp, counts });

  } catch (error) {
    console.error('❌ Feed refresh error:', error.message);
    return res.status(500).json({ error: 'Feed refresh failed', details: error.message });
  }
}

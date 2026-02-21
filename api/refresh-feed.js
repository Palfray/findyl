import { Redis } from '@upstash/redis';
import { gunzipSync } from 'zlib';

// Vercel serverless config — this function needs more time for the large AWIN feed download
export const config = {
  maxDuration: 60, // 60 seconds (Vercel Hobby allows up to 60s for cron functions)
};

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// AWIN feed IDs: 43053 = VinylCastle, 98984 = EMP, 108054 = POPSTORE
const FEED_IDS = '43053,98984,108054';
const COLUMNS = 'aw_deep_link,product_name,aw_product_id,merchant_product_id,merchant_image_url,description,merchant_category,search_price,merchant_name,merchant_id,category_name,category_id,aw_image_url,currency,store_price,delivery_cost,merchant_deep_link,language,last_updated,display_price,data_feed_id,brand_name,brand_id,colour,product_short_description,specifications,condition,product_model,model_number,dimensions,keywords,promotional_text,product_type,commission_group,merchant_product_category_path,merchant_product_second_category,merchant_product_third_category,rrp_price,saving,savings_percent,base_price,base_price_amount,base_price_text,product_price_old,delivery_restrictions,delivery_weight,warranty,terms_of_contract,delivery_time,in_stock,stock_quantity,valid_from,valid_to,is_for_sale,web_offer,pre_order,stock_status,size_stock_status,size_stock_amount,merchant_thumb_url,large_image,alternate_image,aw_thumb_url,alternate_image_two,alternate_image_three,alternate_image_four,reviews,average_rating,rating,number_available,custom_1,custom_2,custom_3,custom_4,custom_5,custom_6,custom_7,custom_8,custom_9,ean,isbn,upc,mpn,parent_product_id,product_GTIN,basket_link';

function buildFeedUrl(apiKey) {
  return `https://productdata.awin.com/datafeed/download/apikey/${apiKey}/language/en/fid/${FEED_IDS}/rid/0/hasEnhancedFeeds/0/columns/${COLUMNS}/format/csv/delimiter/%2C/compression/gzip/adultcontent/1/`;
}

// Parse CSV handling quoted fields with commas inside
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
    headers.forEach((h, idx) => {
      row[h.trim()] = values[idx] || '';
    });
    rows.push(row);
  }
  return rows;
}

// --- EMP Processing ---
// EMP: merchant_category = 'LP', use brand_name as artist
function processEMP(rows) {
  const empRows = rows.filter(r =>
    r.merchant_category === 'LP' &&
    r.in_stock === '1' &&
    r.merchant_name && r.merchant_name.toLowerCase().includes('emp')
  );

  return empRows.map(r => {
    const artist = (r.brand_name || '').trim();
    const productName = (r.product_name || '').trim();

    // Derive album: strip artist prefix + LP [colour] suffix
    let album = productName;
    if (artist && album.toLowerCase().startsWith(artist.toLowerCase())) {
      album = album.substring(artist.length).trim();
    }
    // Remove "LP", "LP [colour]", "2LP", etc.
    album = album
      .replace(/\b\d*LP\b.*$/i, '')
      .replace(/\b(vinyl|gatefold|reissue|remaster|deluxe|limited|edition)\b.*$/gi, '')
      .trim();
    // Remove trailing hyphens/dashes
    album = album.replace(/[\s\-–—]+$/, '').trim();

    if (!artist || !album) return null;

    return {
      artist,
      album,
      title: productName,
      price: parseFloat(r.search_price) || 0,
      link: r.aw_deep_link || '',
      image: r.merchant_image_url || r.aw_image_url || '',
      ean: r.ean || '',
      in_stock: true,
      colour: r.colour || '',
      product_name: productName
    };
  }).filter(Boolean);
}

// --- VinylCastle Processing ---
// VinylCastle: parse artist/album from product_name ("Artist - Album" or use brand_name)
function processVinylCastle(rows) {
  const vcRows = rows.filter(r =>
    r.in_stock === '1' &&
    r.merchant_name && (
      r.merchant_name.toLowerCase().includes('vinyl castle') ||
      r.merchant_name.toLowerCase().includes('vinylcastle')
    )
  );

  return vcRows.map(r => {
    const productName = (r.product_name || '').trim();
    const brandName = (r.brand_name || '').trim();
    let artist = '';
    let album = '';

    // Try "Artist - Album" split from product_name
    const dashSplit = productName.split(' - ');
    if (dashSplit.length >= 2) {
      artist = dashSplit[0].trim();
      album = dashSplit.slice(1).join(' - ').trim();
    } else if (brandName) {
      artist = brandName;
      album = productName;
      // Strip artist prefix from album if present
      if (album.toLowerCase().startsWith(artist.toLowerCase())) {
        album = album.substring(artist.length).trim();
        album = album.replace(/^[\s\-–—]+/, '').trim();
      }
    }

    // Clean album: remove format suffixes
    album = album
      .replace(/\b(vinyl|lp|2xlp|3xlp|12"|7"|10")\b.*$/gi, '')
      .replace(/\(.*?\)/g, '')
      .trim()
      .replace(/[\s\-–—]+$/, '')
      .trim();

    if (!artist || !album) return null;

    const price = parseFloat(r.search_price) || 0;
    if (price <= 0) return null;

    return {
      artist,
      album,
      price,
      currency: r.currency || 'GBP',
      link: r.aw_deep_link || '',
      image: r.merchant_image_url || r.aw_image_url || '',
      availability: 'In Stock',
      ean: r.ean || '',
      product_name: productName
    };
  }).filter(Boolean);
}

// --- POPSTORE Processing ---
// POPSTORE: parse from product_name, filter vinyl products
function processPOPSTORE(rows) {
  const popRows = rows.filter(r =>
    r.in_stock === '1' &&
    r.merchant_name && (
      r.merchant_name.toLowerCase().includes('popstore') ||
      r.merchant_name.toLowerCase().includes('pop store')
    )
  );

  // Filter to vinyl products: check category, product_name, description
  const vinylRows = popRows.filter(r => {
    const name = (r.product_name || '').toLowerCase();
    const cat = (r.merchant_category || '').toLowerCase();
    const desc = (r.description || '').toLowerCase();
    const catPath = (r.merchant_product_category_path || '').toLowerCase();

    return (
      cat.includes('vinyl') || cat.includes('lp') || cat === 'records' ||
      catPath.includes('vinyl') || catPath.includes('records') ||
      name.includes('vinyl') || name.includes(' lp') ||
      name.includes(' lp,') || name.includes(' lp ') ||
      desc.includes('vinyl') || desc.includes('gramophone') ||
      desc.includes('12-inch') || desc.includes('33rpm')
    );
  });

  return vinylRows.map(r => {
    const productName = (r.product_name || '').trim();
    const brandName = (r.brand_name || '').trim();
    let artist = '';
    let album = '';

    // POPSTORE product names often follow "Artist - Album" or "Artist - Album, Vinyl"
    const dashSplit = productName.split(' - ');
    if (dashSplit.length >= 2) {
      artist = dashSplit[0].trim();
      album = dashSplit.slice(1).join(' - ').trim();
    } else if (brandName) {
      artist = brandName;
      album = productName;
    }

    // Clean album: remove ", Vinyl" and format suffixes
    album = album
      .replace(/,\s*(vinyl|lp).*$/i, '')
      .replace(/\b(vinyl|lp|2xlp|3xlp|gatefold|coloured|colored|limited|edition|deluxe)\b.*$/gi, '')
      .replace(/\(.*?\)/g, '')
      .trim()
      .replace(/[\s\-–—]+$/, '')
      .trim();

    if (!artist || !album) return null;

    const price = parseFloat(r.search_price) || 0;
    if (price <= 0) return null;

    return {
      artist,
      album,
      title: productName,
      price,
      link: r.aw_deep_link || '',
      image: r.merchant_image_url || r.aw_image_url || '',
      availability: 'In Stock',
      ean: r.ean || '',
      product_name: productName,
      url: r.merchant_deep_link || r.aw_deep_link || ''
    };
  }).filter(Boolean);
}

export default async function handler(req, res) {
  // Verify this is a cron job call or has auth
  const authHeader = req.headers.authorization;
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const isManual = req.query.key === process.env.AWIN_API_KEY;

  // Allow cron, manual trigger with key, or Vercel internal cron
  if (!isCron && !isManual && !req.headers['x-vercel-cron']) {
    // Still allow it but log a warning — Vercel hobby crons don't send CRON_SECRET
    console.log('⚠️ No auth header, but proceeding (Vercel hobby plan cron)');
  }

  const apiKey = process.env.AWIN_API_KEY;
  if (!apiKey) {
    console.error('❌ AWIN_API_KEY not set');
    return res.status(500).json({ error: 'AWIN_API_KEY not configured' });
  }

  const feedUrl = buildFeedUrl(apiKey);
  console.log('📥 Fetching AWIN combined feed...');

  try {
    // Fetch the gzip feed with a 60-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    const response = await fetch(feedUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`AWIN returned ${response.status}: ${response.statusText}`);
    }

    // Get the gzip buffer and decompress
    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`📦 Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`);

    const csvText = gunzipSync(buffer).toString('utf-8');
    console.log('📄 Decompressed CSV');

    // Parse all rows
    const allRows = parseCSV(csvText);
    console.log(`📊 Total rows: ${allRows.length}`);

    // Process each retailer
    const empProducts = processEMP(allRows);
    const vcProducts = processVinylCastle(allRows);
    const popProducts = processPOPSTORE(allRows);

    console.log(`🏪 EMP: ${empProducts.length} vinyl products`);
    console.log(`🏪 VinylCastle: ${vcProducts.length} vinyl products`);
    console.log(`🏪 POPSTORE: ${popProducts.length} vinyl products`);

    // Store in Upstash Redis
    // Split large datasets into chunks if needed (Upstash has ~1MB per command limit)
    // EMP and POPSTORE are small enough for single keys
    // VinylCastle may need chunking

    const VC_CHUNK_SIZE = 5000;
    const vcChunks = [];
    for (let i = 0; i < vcProducts.length; i += VC_CHUNK_SIZE) {
      vcChunks.push(vcProducts.slice(i, i + VC_CHUNK_SIZE));
    }

    // Store EMP (single key)
    await redis.set('feed:emp', JSON.stringify(empProducts));
    console.log('✅ Stored EMP feed');

    // Store POPSTORE (single key)
    await redis.set('feed:popstore', JSON.stringify(popProducts));
    console.log('✅ Stored POPSTORE feed');

    // Store VinylCastle (chunked)
    await redis.set('feed:vc:meta', JSON.stringify({ chunks: vcChunks.length, total: vcProducts.length }));
    for (let i = 0; i < vcChunks.length; i++) {
      await redis.set(`feed:vc:${i}`, JSON.stringify(vcChunks[i]));
    }
    console.log(`✅ Stored VinylCastle feed (${vcChunks.length} chunks)`);

    // Store timestamp
    const timestamp = new Date().toISOString();
    await redis.set('feed:updated', timestamp);
    console.log(`✅ Feed refresh complete at ${timestamp}`);

    return res.status(200).json({
      success: true,
      updated: timestamp,
      counts: {
        emp: empProducts.length,
        vinylcastle: vcProducts.length,
        popstore: popProducts.length,
        total_rows: allRows.length
      }
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('❌ AWIN feed fetch timed out after 60 seconds');
      return res.status(408).json({ error: 'Feed fetch timeout' });
    }
    console.error('❌ Feed refresh error:', error.message);
    return res.status(500).json({ error: 'Feed refresh failed', details: error.message });
  }
}

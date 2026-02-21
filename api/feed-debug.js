import { createGunzip } from 'zlib';
import { Readable } from 'stream';

export const config = { maxDuration: 30 };

const COLUMNS = 'product_name,merchant_name,merchant_category,brand_name,in_stock,search_price';

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
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) { fields.push(current); current = ''; }
    else current += char;
  }
  fields.push(current);
  return fields;
}

export default async function handler(req, res) {
  const apiKey = process.env.AWIN_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'no key' });

  const feedId = req.query.feed || '98984';
  const url = buildFeedUrl(apiKey, feedId);

  const response = await fetch(url);
  if (!response.ok) return res.status(500).json({ error: `AWIN ${response.status}` });

  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(response.body);

  return new Promise((resolve) => {
    const categories = new Map();
    const sampleRows = [];
    let headers = [];
    let buffer = '';
    let headerParsed = false;
    let total = 0;
    let inStock = 0;

    nodeStream.pipe(gunzip);

    gunzip.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      let idx;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.substring(0, idx).trim();
        buffer = buffer.substring(idx + 1);
        if (!line) continue;
        if (!headerParsed) { headers = parseCSVLine(line); headerParsed = true; continue; }
        total++;
        const values = parseCSVLine(line);
        if (values.length !== headers.length) continue;
        const row = {};
        headers.forEach((h, i) => { row[h.trim()] = values[i] || ''; });

        if (row.in_stock === '1') inStock++;

        const cat = row.merchant_category || '(empty)';
        categories.set(cat, (categories.get(cat) || 0) + 1);

        if (sampleRows.length < 10 && row.in_stock === '1') {
          sampleRows.push({ name: row.product_name, cat: row.merchant_category, brand: row.brand_name, price: row.search_price });
        }
      }
    });

    gunzip.on('end', () => {
      const sorted = [...categories.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
      res.status(200).json({
        feedId,
        totalRows: total,
        inStock,
        topCategories: sorted,
        sampleProducts: sampleRows,
        headers
      });
      resolve();
    });

    gunzip.on('error', (err) => {
      res.status(500).json({ error: err.message });
      resolve();
    });
  });
}

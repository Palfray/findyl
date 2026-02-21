import { createGunzip } from 'zlib';
import { Readable } from 'stream';

export const config = { maxDuration: 30 };

const COLUMNS = 'product_name,merchant_category,brand_name,search_price,rrp_price,in_stock,saving,savings_percent';

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

  const feedId = req.query.feed || '43053';
  const url = buildFeedUrl(apiKey, feedId);

  const response = await fetch(url);
  if (!response.ok) return res.status(500).json({ error: `AWIN ${response.status}` });

  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(response.body);

  return new Promise((resolve) => {
    const samplesWithRRP = [];
    const samplesWithSaving = [];
    let headers = [];
    let buffer = '';
    let headerParsed = false;
    let total = 0;
    let hasRRP = 0;
    let hasSaving = 0;
    let hasSavingsPercent = 0;
    let vinylOnly = 0;

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

        if (row.in_stock !== '1') continue;

        // Check vinyl categories
        const cat = row.merchant_category || '';
        const isVinyl = cat === 'LP' || cat === 'Vinyl' || cat === '855';
        if (!isVinyl) continue;
        vinylOnly++;

        const rrp = parseFloat(row.rrp_price) || 0;
        const price = parseFloat(row.search_price) || 0;
        const saving = row.saving || '';
        const savingsPct = row.savings_percent || '';

        if (rrp > 0) {
          hasRRP++;
          if (samplesWithRRP.length < 10) {
            samplesWithRRP.push({
              name: row.product_name,
              price,
              rrp,
              discount: rrp > price ? Math.round((1 - price / rrp) * 100) + '%' : '0%',
              saving,
              savings_percent: savingsPct
            });
          }
        }
        if (saving && saving !== '0' && saving !== '0.00') {
          hasSaving++;
          if (samplesWithSaving.length < 5) {
            samplesWithSaving.push({ name: row.product_name, price, saving, savings_percent: savingsPct });
          }
        }
        if (savingsPct && savingsPct !== '0' && savingsPct !== '0.00') {
          hasSavingsPercent++;
        }
      }
    });

    gunzip.on('end', () => {
      res.status(200).json({
        feedId,
        totalRows: total,
        vinylProducts: vinylOnly,
        rrpStats: {
          hasRRP,
          percentWithRRP: vinylOnly > 0 ? Math.round(hasRRP / vinylOnly * 100) + '%' : '0%',
          hasSaving,
          hasSavingsPercent
        },
        samplesWithRRP,
        samplesWithSaving,
        headers
      });
      resolve();
    });

    gunzip.on('error', (err) => { res.status(500).json({ error: err.message }); resolve(); });
  });
}

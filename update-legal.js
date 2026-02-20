#!/usr/bin/env node
/**
 * findyl legal compliance batch updater
 * 
 * Run from the root of your findyl repo:
 *   node update-legal.js
 * 
 * Then commit and push:
 *   git add -A && git commit -m "Add legal pages, footer links, inline disclosures" && git push
 */

const fs = require('fs');
const path = require('path');

const LEGAL_LINKS = `        <p style="margin-top:8px;">
            <a href="/privacy" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Privacy</a>
            <a href="/terms" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Terms</a>
            <a href="/disclosure" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Affiliate Disclosure</a>
        </p>`;

// Same but with Tailwind classes for white-bg footers
const LEGAL_LINKS_TAILWIND = `            <p class="mt-2 text-xs text-gray-400">
                <a href="/privacy" class="hover:underline mx-1">Privacy</a> · 
                <a href="/terms" class="hover:underline mx-1">Terms</a> · 
                <a href="/disclosure" class="hover:underline mx-1">Affiliate Disclosure</a>
            </p>`;

let changes = [];

function updateFile(filename, replacements) {
    const filepath = path.join(__dirname, filename);
    if (!fs.existsSync(filepath)) {
        console.log(`  ⚠ SKIP ${filename} (not found)`);
        return;
    }
    let content = fs.readFileSync(filepath, 'utf8');
    let changed = false;

    // Skip if already has /privacy link
    if (content.includes('href="/privacy"')) {
        console.log(`  ✓ SKIP ${filename} (already updated)`);
        return;
    }

    for (const [search, replace] of replacements) {
        if (content.includes(search)) {
            content = content.replace(search, replace);
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(filepath, content, 'utf8');
        changes.push(filename);
        console.log(`  ✅ ${filename}`);
    } else {
        console.log(`  ⚠ ${filename} — no matching patterns found`);
    }
}

console.log('\n🔧 findyl legal compliance updater\n');
console.log('=== Updating footers ===\n');

// --- DARK FOOTERS (about, article, articles) ---
// These all have the same pattern: </p>\n    </footer> after the Find a store link

const DARK_FOOTER_LEGAL = [
    // about.html
    [`            <a href="/local-stores" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Find a store</a>
        </p>
    </footer>`,
    `            <a href="/local-stores" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Find a store</a>
        </p>
${LEGAL_LINKS}
    </footer>`]
];

// Same pattern but with 2-space indent (article.html, articles.html use 2-space)
const DARK_FOOTER_LEGAL_2SP = [
    [`      <a href="/local-stores" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Find a store</a>
    </p>
  </footer>`,
    `      <a href="/local-stores" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Find a store</a>
    </p>
    <p style="margin-top:8px;">
      <a href="/privacy" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Privacy</a>
      <a href="/terms" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Terms</a>
      <a href="/disclosure" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Affiliate Disclosure</a>
    </p>
  </footer>`]
];

updateFile('about.html', DARK_FOOTER_LEGAL);
updateFile('article.html', DARK_FOOTER_LEGAL_2SP);
updateFile('articles.html', DARK_FOOTER_LEGAL_2SP);

// --- WHITE FOOTERS (index, sales) ---
const WHITE_FOOTER_REPLACE = [
    [`                <p class="text-sm">Compare prices across POPSTORE, Vinyl Castle, EMP UK, and more.</p>
            </div>
        </div>
    </footer>`,
    `                <p class="text-sm">Compare prices across POPSTORE, Vinyl Castle, EMP UK, and more.</p>
${LEGAL_LINKS_TAILWIND}
            </div>
        </div>
    </footer>`]
];

updateFile('index.html', WHITE_FOOTER_REPLACE);
updateFile('sales.html', WHITE_FOOTER_REPLACE);

// --- LOCAL STORES (unique footer) ---
updateFile('local-stores.html', [
    [`            <p class="mt-1">findyl — Finding Vinyl, Made Simple</p>
        </div>
    </footer>`,
    `            <p class="mt-1">findyl — Finding Vinyl, Made Simple</p>
${LEGAL_LINKS_TAILWIND}
        </div>
    </footer>`]
]);

// --- OLD ARTICLE PAGES (white footer with logo) ---
// article-best-selling-vinyl-2025.html & article-template.html
// These have a different footer pattern — add legal links before closing </footer>
for (const f of ['article-best-selling-vinyl-2025.html', 'article-template.html']) {
    updateFile(f, [
        [`            </div>
        </div>
    </footer>`,
        `            </div>
${LEGAL_LINKS_TAILWIND}
        </div>
    </footer>`]
    ]);
}

// --- PAGES WITHOUT FOOTERS (album, artist, results) — inject before </body> ---
console.log('\n=== Adding footers to pages that lack them ===\n');

const FULL_DARK_FOOTER = `
    <!-- Footer -->
    <footer style="background:#1F2937;color:#9CA3AF;padding:40px 20px;text-align:center;font-size:0.85rem;">
        <p>&copy; 2026 findyl. Helping you find vinyl records from UK retailers.</p>
        <p style="margin-top:8px;">
            <a href="/about" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">About</a>
            <a href="/articles" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Sleeve Notes</a>
            <a href="/local-stores" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Find a store</a>
        </p>
        <p style="margin-top:8px;">
            <a href="/privacy" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Privacy</a>
            <a href="/terms" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Terms</a>
            <a href="/disclosure" style="color:#9CA3AF;text-decoration:underline;margin:0 8px;">Affiliate Disclosure</a>
        </p>
    </footer>`;

for (const f of ['artist.html', 'results.html']) {
    const filepath = path.join(__dirname, f);
    if (!fs.existsSync(filepath)) { console.log(`  ⚠ SKIP ${f}`); continue; }
    let content = fs.readFileSync(filepath, 'utf8');
    if (content.includes('href="/privacy"')) { console.log(`  ✓ SKIP ${f} (already updated)`); continue; }
    
    // Find the LAST </script> tag, insert footer after it (before </body>)
    const lastScriptClose = content.lastIndexOf('</script>');
    if (lastScriptClose === -1) { console.log(`  ⚠ ${f} — no </script> found`); continue; }
    const insertPoint = content.indexOf('\n', lastScriptClose) + 1;
    content = content.slice(0, insertPoint) + FULL_DARK_FOOTER + '\n' + content.slice(insertPoint);
    fs.writeFileSync(filepath, content, 'utf8');
    changes.push(f);
    console.log(`  ✅ ${f} (footer added)`);
}

// --- ALBUM PAGE: footer + inline disclosure ---
console.log('\n=== Album page: footer + inline affiliate disclosure ===\n');
{
    const filepath = path.join(__dirname, 'album.html');
    let content = fs.readFileSync(filepath, 'utf8');
    if (content.includes('href="/privacy"')) {
        console.log('  ✓ SKIP album.html (already updated)');
    } else {
        // 1. Add footer before </body>
        const lastScriptClose = content.lastIndexOf('</script>');
        const insertPoint = content.indexOf('\n', lastScriptClose) + 1;
        content = content.slice(0, insertPoint) + FULL_DARK_FOOTER + '\n' + content.slice(insertPoint);

        // 2. Add inline affiliate disclosure below "Buy This Album" heading
        content = content.replace(
            '<h2 class="text-xl font-bold mb-4">Buy This Album</h2>',
            `<h2 class="text-xl font-bold mb-4">Buy This Album</h2>
                        <p style="font-size:0.75rem;color:#9CA3AF;margin:-8px 0 16px 0;">Prices from selected UK retailers. findyl may earn a commission from purchases — <a href="/disclosure" style="color:#9CA3AF;text-decoration:underline;">learn more</a></p>`
        );

        fs.writeFileSync(filepath, content, 'utf8');
        changes.push('album.html');
        console.log('  ✅ album.html (footer + inline disclosure added)');
    }
}

// --- ARTICLE TEMPLATE: inline disclosure ---
console.log('\n=== Article template: inline disclosure ===\n');
{
    const filepath = path.join(__dirname, 'article.html');
    let content = fs.readFileSync(filepath, 'utf8');
    if (content.includes('affiliate-notice')) {
        console.log('  ✓ SKIP article.html inline disclosure (already present)');
    } else {
        // Add disclosure div that gets shown/hidden based on whether article has affiliate links
        // Insert after the date/category meta line
        content = content.replace(
            `<p id="article-date"`,
            `<p id="affiliate-notice" style="display:none;font-size:0.8rem;color:#9CA3AF;margin-top:12px;">This article contains links to retailers where findyl may earn a commission. <a href="/disclosure" style="color:#9CA3AF;text-decoration:underline;">Learn more</a></p>
      <p id="article-date"`
        );

        // Show the notice after article loads — add to the render function
        content = content.replace(
            `document.getElementById('article-body').innerHTML = html;`,
            `document.getElementById('article-body').innerHTML = html;
        // Show affiliate notice if article contains outbound retailer links
        if (html.includes('/artist') || html.includes('/album') || html.includes('/results')) {
          const notice = document.getElementById('affiliate-notice');
          if (notice) notice.style.display = 'block';
        }`
        );

        fs.writeFileSync(filepath, content, 'utf8');
        changes.push('article.html (inline disclosure)');
        console.log('  ✅ article.html (inline disclosure added)');
    }
}

console.log(`\n✅ Done! ${changes.length} files updated:\n`);
changes.forEach(f => console.log(`   ${f}`));
console.log('\nNext steps:');
console.log('  1. Upload the 3 new pages (privacy.html, terms.html, disclosure.html)');
console.log('  2. Upload updated vercel.json and sitemap.xml');
console.log('  3. git add -A && git commit -m "Legal compliance: privacy, terms, disclosure" && git push');
console.log('  4. Submit new URLs in Google Search Console\n');

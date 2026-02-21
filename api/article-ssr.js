// Server-side rendered article page
// Pre-renders title, meta tags, JSON-LD schema, OG tags, canonical URL,
// and full article body in the initial HTML for Googlebot.
// Client-side JS still enhances the page (nav pills, autocomplete, etc.)

import { readFileSync } from 'fs';
import { join } from 'path';
import { marked } from 'marked';

// Cache the article index in memory (cold start only)
let articlesIndex = null;
function getArticlesIndex() {
  if (!articlesIndex) {
    const raw = readFileSync(join(process.cwd(), 'articles-index.json'), 'utf-8');
    articlesIndex = JSON.parse(raw);
  }
  return articlesIndex;
}

function getMarkdown(slug) {
  const filePath = join(process.cwd(), 'content', `${slug}.md`);
  return readFileSync(filePath, 'utf-8');
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

const seriesNames = {
  'genre-spotlight': 'Genre Spotlight',
  'behind-the-sample': 'Behind the Sample',
  'history-of': 'The History of…'
};

function buildTagsHtml(meta) {
  let html = '';
  if (meta.category) {
    html += `<a href="/articles" class="article-tag">${cap(meta.category)}</a>`;
  }
  if (meta.series && seriesNames[meta.series]) {
    html += '<span class="article-tag-dot">·</span>';
    html += `<a href="/articles" class="article-tag">${seriesNames[meta.series]}</a>`;
  }
  if (meta.genre) {
    html += '<span class="article-tag-dot">·</span>';
    html += `<a href="/articles" class="article-tag">${cap(meta.genre)}</a>`;
  }
  return html;
}

function buildContentNavHtml(meta) {
  const categories = [
    { label: 'All', cat: null },
    { label: 'Charts', cat: 'charts' },
    { label: 'Features', cat: 'features' },
    { label: 'Guides', cat: 'guides' }
  ];
  return categories.map(c => {
    const isActive = c.cat && c.cat === meta.category;
    const cls = isActive ? ' class="active"' : '';
    return `<a href="/articles"${cls}>${c.label}</a>`;
  }).join('');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function buildJsonLd(meta, slug) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": meta.title,
    "description": meta.description,
    "url": `https://findyl.co.uk/articles/${slug}`,
    "publisher": {
      "@type": "Organization",
      "name": "findyl",
      "url": "https://findyl.co.uk",
      "logo": {
        "@type": "ImageObject",
        "url": "https://findyl.co.uk/favicon.svg"
      }
    },
    "mainEntityOfPage": {
      "@type": "WebPage",
      "@id": `https://findyl.co.uk/articles/${slug}`
    }
  };
  if (meta.date) schema.datePublished = meta.date;
  if (meta.date) schema.dateModified = meta.date;
  if (meta.ogImage) {
    schema.image = { "@type": "ImageObject", "url": meta.ogImage };
  }
  return JSON.stringify(schema);
}

export default function handler(req, res) {
  const { slug } = req.query;

  if (!slug) {
    res.writeHead(302, { Location: '/articles' });
    return res.end();
  }

  let index, meta, markdown;
  try {
    index = getArticlesIndex();
    meta = index.find(a => a.slug === slug);
    if (!meta) throw new Error('Not in index');
    markdown = getMarkdown(slug);
  } catch (e) {
    // Fall back to 404
    res.statusCode = 404;
    return res.end(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Article not found — findyl</title></head><body><h1>Article not found</h1><p><a href="/articles">Browse all articles</a></p></body></html>`);
  }

  // Render markdown — strip leading H1
  let md = markdown.trim().replace(/^#\s+.+\n+/, '');
  marked.setOptions({ breaks: false, gfm: true });
  const bodyHtml = marked.parse(md);

  // Check for internal links (for affiliate notice)
  const hasInternalLinks = /href="[^"]*\/(artist|album|results)/.test(bodyHtml);

  // Date display
  const dateHtml = meta.category !== 'guides' ? formatDate(meta.date) : '';

  // Hero image
  const heroHtml = meta.heroImage
    ? `<div id="article-hero-wrap" style="margin-bottom:32px;">
        <img id="article-hero" class="hero-image" src="${escapeHtml(meta.heroImage)}" alt="${escapeHtml(meta.heroAlt || meta.title)}" loading="eager" fetchpriority="high" decoding="async">
      </div>`
    : '';

  const pageTitle = escapeHtml(meta.title) + ' — findyl';
  const pageDesc = escapeHtml(meta.description);
  const canonicalUrl = `https://findyl.co.uk/articles/${slug}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle}</title>
  <meta name="description" content="${pageDesc}">
  <link rel="canonical" href="${canonicalUrl}">
  <meta property="og:title" content="${escapeHtml(meta.title)}">
  <meta property="og:description" content="${pageDesc}">
  <meta property="og:image" content="${escapeHtml(meta.ogImage || '')}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${canonicalUrl}">
  <meta property="og:site_name" content="findyl">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <!-- JSON-LD Article Schema -->
  <script type="application/ld+json">${buildJsonLd(meta, slug)}</script>
  <!-- Google Analytics -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-4VKXNETWR4"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-4VKXNETWR4');</script>
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Raleway:wght@400;500&display=swap" rel="stylesheet">
  <!-- Tailwind -->
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { font-family: 'DM Serif Display', serif; font-weight: 400; color: #374151; }
    h1, h2, h3, h4, h5, h6 { font-family: 'DM Serif Display', serif; font-weight: 700; color: #111827; letter-spacing: -0.01em; }
    .article-prose h1 { font-size: 2.25rem; line-height: 1.2; margin-bottom: 1.5rem; }
    .article-prose h2 { font-size: 1.5rem; line-height: 1.3; margin-top: 2.5rem; margin-bottom: 1rem; }
    .article-prose h3 { font-size: 1.25rem; line-height: 1.4; margin-top: 2rem; margin-bottom: 0.75rem; }
    .article-prose p { font-size: 1.05rem; line-height: 1.75; margin-bottom: 1.25rem; }
    .article-prose em { font-style: italic; }
    .article-prose strong { font-weight: 700; color: #111827; }
    .article-prose a { color: #FF6B6B; text-decoration: underline; text-underline-offset: 2px; }
    .article-prose a:hover { color: #e55a5a; }
    .article-prose blockquote { border-left: 3px solid #FF6B6B; padding-left: 1.25rem; margin: 1.5rem 0; color: #6B7280; font-style: italic; }
    .article-prose ul, .article-prose ol { margin: 1rem 0 1.25rem 1.5rem; }
    .article-prose li { font-size: 1.05rem; line-height: 1.75; margin-bottom: 0.5rem; }
    .article-prose ul li { list-style-type: disc; }
    .article-prose ol li { list-style-type: decimal; }
    .article-prose hr { border: none; border-top: 1px solid #E5E7EB; margin: 2rem 0; }
    .article-prose img { max-width: 100%; border-radius: 8px; margin: 1.5rem 0; }
    .article-prose table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: 0.95rem; }
    .article-prose thead th { text-align: left; padding: 0.75rem 1rem; border-bottom: 2px solid #E5E7EB; font-weight: 700; color: #111827; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; }
    .article-prose tbody td { padding: 0.65rem 1rem; border-bottom: 1px solid #F3F4F6; }
    .article-prose tbody tr:hover { background: #F9FAFB; }
    .article-prose tbody td:first-child { color: #9CA3AF; font-weight: 700; width: 2rem; }
    @media (max-width: 640px) {
      .article-prose table { font-size: 0.85rem; }
      .article-prose thead th, .article-prose tbody td { padding: 0.5rem 0.5rem; }
      .article-prose h1 { font-size: 1.75rem; }
      #article-title { font-size: 1.75rem !important; }
    }
    .content-nav { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #E5E7EB; }
    .content-nav a { padding: 6px 18px; border-radius: 9999px; font-size: 0.85rem; font-weight: 500; text-decoration: none; border: 1.5px solid #D1D5DB; background: #fff; color: #6B7280; transition: all 0.15s ease; }
    .content-nav a:hover { border-color: #FF6B6B; color: #FF6B6B; }
    .content-nav a.active { background: #FF6B6B; color: #fff; border-color: #FF6B6B; }
    .hero-image { width: 100%; max-height: 520px; object-fit: contain; background: #000; border-radius: 8px; }
    .article-tags { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
    .article-tag { display: inline-block; background: #FFE5E5; color: #FF6B6B; font-size: 0.72rem; font-weight: 400; padding: 4px 12px; border-radius: 9999px; letter-spacing: 0.03em; text-decoration: none; text-transform: uppercase; transition: background 0.2s; }
    .article-tag:hover { background: #FFD4D4; }
    .article-tag-dot { color: #D1D5DB; font-size: 0.6rem; }
    .affiliate-notice { font-size: 0.75rem; color: #9CA3AF; margin-top: 8px; }
    .affiliate-notice a { color: #9CA3AF; text-decoration: underline; }
  </style>
</head>
<body class="bg-gray-50">

  <!-- HEADER -->
  <header id="site-header" style="position:sticky;top:0;z-index:20;background:#fff;border-bottom:1px solid #E5E7EB;">
    <div style="max-width:1100px;margin:0 auto;padding:12px 20px;display:flex;align-items:center;gap:16px;">
      <a href="/" style="flex-shrink:0;text-decoration:none;">
        <svg width="128" height="40" viewBox="0 0 320 100" fill="none">
          <text x="0" y="72" font-family="'DM Serif Display', serif" font-size="80" fill="#1F2937" font-weight="400">findyl</text>
          <g transform="translate(245, 50)">
            <circle cx="0" cy="0" r="28" fill="#FF6B6B"/>
            <circle cx="0" cy="0" r="22" fill="none" stroke="white" stroke-width="1"/>
            <circle cx="0" cy="0" r="16" fill="none" stroke="white" stroke-width="1"/>
            <circle cx="0" cy="0" r="10" fill="none" stroke="white" stroke-width="1"/>
            <circle cx="0" cy="0" r="8" fill="white"/>
            <circle cx="0" cy="0" r="3" fill="#FF6B6B"/>
          </g>
        </svg>
      </a>
      <form id="header-search-form" action="/results" method="GET" style="flex:1;max-width:480px;position:relative;">
        <input type="text" name="q" id="header-search-input" placeholder="Search for vinyl..."
          style="width:100%;padding:10px 44px 10px 16px;border:1.5px solid #111827;border-radius:9999px;font-family:'Raleway',sans-serif;font-size:0.95rem;font-weight:400;outline:none;background:#fff;">
        <button type="submit" style="position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;padding:0;">
          <svg width="20" height="20" fill="none" stroke="#FF6B6B" stroke-width="2.5" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        </button>
        <div id="header-autocomplete" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #E5E7EB;border-radius:12px;margin-top:4px;box-shadow:0 8px 24px rgba(0,0,0,0.12);z-index:50;max-height:400px;overflow-y:auto;"></div>
      </form>
    </div>
  </header>

  <!-- ARTICLE CONTENT (server-rendered) -->
  <main style="max-width:740px;margin:0 auto;padding:32px 20px 80px;">
    <article id="article-container">
      <!-- Content navigation -->
      <div id="content-nav" class="content-nav">${buildContentNavHtml(meta)}</div>

      <!-- Tags -->
      <div id="article-tags" class="article-tags">${buildTagsHtml(meta)}</div>

      <!-- Title -->
      <h1 id="article-title" style="font-size:2.25rem;line-height:1.2;margin:0 0 16px;color:#111827;">${escapeHtml(meta.title)}</h1>

      <!-- Date -->
      <div style="margin-bottom:20px;">
        <span id="article-date" style="color:#9CA3AF;font-size:0.85rem;">${dateHtml}</span>
      </div>

      <!-- Hero image -->
      ${heroHtml}

      <!-- Affiliate notice -->
      ${hasInternalLinks ? '<div id="article-affiliate" class="affiliate-notice">This article contains links to retailers where findyl may earn a commission. <a href="/disclosure">Learn more</a></div>' : ''}

      <!-- Rendered article body -->
      <div id="article-body" class="article-prose">${bodyHtml}</div>

      <!-- Back link -->
      <div style="margin-top:48px;padding-top:24px;border-top:1px solid #E5E7EB;">
        <a href="/articles" style="color:#FF6B6B;text-decoration:none;font-size:0.95rem;">← Sleeve Notes</a>
      </div>
    </article>
  </main>

  <!-- FOOTER -->
  <footer style="background:#1F2937;color:#9CA3AF;padding:40px 20px;text-align:center;font-size:0.85rem;">
    <p>© 2026 findyl. Helping you find vinyl records from UK retailers.</p>
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
  </footer>

  <!-- Client-side enhancements (autocomplete) -->
  <script>
  (function() {
    const input = document.getElementById('header-search-input');
    const dropdown = document.getElementById('header-autocomplete');
    const form = document.getElementById('header-search-form');
    let debounceTimer;
    if (!input || !dropdown || !form) return;
    form.addEventListener('submit', function(e) {
      e.preventDefault();
      const q = input.value.trim();
      if (q) window.location.href = '/results?q=' + encodeURIComponent(q);
    });
    input.addEventListener('input', function() {
      clearTimeout(debounceTimer);
      const q = input.value.trim();
      if (q.length < 2) { dropdown.style.display = 'none'; return; }
      debounceTimer = setTimeout(() => {
        fetch('/api/autocomplete?q=' + encodeURIComponent(q))
          .then(r => r.json())
          .then(data => {
            if (!data.artists?.length && !data.albums?.length) { dropdown.style.display = 'none'; return; }
            let html = '';
            if (data.artists?.length) {
              html += '<div style="padding:8px 16px;font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;">Artists</div>';
              data.artists.forEach(a => {
                const meta = [a.type, a.country, a.disambiguation].filter(Boolean).join(' · ');
                html += '<a href="/results?q=' + encodeURIComponent(a.name) + '" style="display:block;padding:10px 16px;text-decoration:none;color:#1F2937;font-size:0.95rem;border-bottom:1px solid #F3F4F6;">' + a.name + (meta ? '<span style="color:#9CA3AF;font-size:0.8rem;margin-left:8px;">' + meta + '</span>' : '') + '</a>';
              });
            }
            if (data.albums?.length) {
              html += '<div style="padding:8px 16px;font-size:0.7rem;color:#9CA3AF;text-transform:uppercase;letter-spacing:0.05em;">Albums</div>';
              data.albums.forEach(a => {
                html += '<a href="/album?artist=' + encodeURIComponent(a.artist || '') + '&album=' + encodeURIComponent(a.name) + '" style="display:block;padding:10px 16px;text-decoration:none;color:#1F2937;font-size:0.95rem;border-bottom:1px solid #F3F4F6;">' + a.name + (a.artist ? '<span style="color:#9CA3AF;font-size:0.8rem;margin-left:8px;">' + a.artist + '</span>' : '') + '</a>';
              });
            }
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
          })
          .catch(() => { dropdown.style.display = 'none'; });
      }, 300);
    });
    document.addEventListener('click', function(e) {
      if (!dropdown.contains(e.target) && e.target !== input) dropdown.style.display = 'none';
    });
  })();
  </script>

</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.end(html);
}

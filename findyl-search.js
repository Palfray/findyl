/**
 * findyl-search.js — Shared search, autocomplete & "did you mean" for ALL pages
 * 
 * Works with:
 *   - Inner pages: single header search bar
 *     Expects: #header-search-form, #header-search-input, #header-autocomplete
 *
 *   - Homepage: hero search + sticky header search (two bars, synced)
 *     Expects: #hero-search-form, #hero-search-input, #hero-autocomplete
 *              #header-search-form, #header-search-input, #header-autocomplete
 *
 *   Gracefully handles any combination — missing elements are skipped.
 *
 * Features:
 *   - Polished autocomplete dropdown with category headers, avatars, keyboard nav
 *   - Matched text highlighted in coral
 *   - "Search for [query]" fallback link at bottom of dropdown
 *   - "Did you mean?" fuzzy spell correction (results page only)
 *   - Homepage: typing in one bar syncs the other
 */
(function () {
    'use strict';

    // ── Collect all search bar instances on the page ──
    // Each "instance" is a { form, input, dropdown } triple
    const instances = [];

    const SEARCH_IDS = [
        { form: 'header-search-form', input: 'header-search-input', dropdown: 'header-autocomplete' },
        { form: 'hero-search-form',   input: 'hero-search-input',   dropdown: 'hero-autocomplete' },
    ];

    SEARCH_IDS.forEach(ids => {
        const form = document.getElementById(ids.form);
        const input = document.getElementById(ids.input);
        const dropdown = document.getElementById(ids.dropdown);
        if (form && input && dropdown) {
            instances.push({ form, input, dropdown });
        }
    });

    if (instances.length === 0) return;

    let debounceTimer;
    let activeInstance = null; // which search bar is currently active

    // ── Wire up each instance ──
    instances.forEach(inst => {
        // Form submit
        inst.form.addEventListener('submit', (e) => {
            e.preventDefault();
            const q = inst.input.value.trim();
            if (q) window.location.href = `/results?q=${encodeURIComponent(q)}`;
        });

        // Input with debounce + sync other bars
        inst.input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            activeInstance = inst;
            inst._selectedIndex = -1;
            const q = inst.input.value.trim();

            // Sync other search bars
            instances.forEach(other => {
                if (other !== inst) other.input.value = inst.input.value;
            });

            if (q.length < 2) { hideAllDropdowns(); return; }
            debounceTimer = setTimeout(() => fetchSuggestions(q, inst), 250);
        });

        // Keyboard navigation
        inst.input.addEventListener('keydown', (e) => {
            if (inst.dropdown.classList.contains('hidden')) return;
            const items = inst.dropdown.querySelectorAll('[data-suggestion]');
            if (!items.length) return;

            const idx = inst._selectedIndex || -1;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                inst._selectedIndex = Math.min((inst._selectedIndex ?? -1) + 1, items.length - 1);
                highlightItems(inst.dropdown, inst._selectedIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                inst._selectedIndex = Math.max((inst._selectedIndex ?? 0) - 1, -1);
                highlightItems(inst.dropdown, inst._selectedIndex);
            } else if (e.key === 'Enter' && (inst._selectedIndex ?? -1) >= 0) {
                e.preventDefault();
                items[inst._selectedIndex].click();
            } else if (e.key === 'Escape') {
                hideAllDropdowns();
                inst.input.blur();
            }
        });

        // Focus re-opens dropdown
        inst.input.addEventListener('focus', () => {
            activeInstance = inst;
            // Hide other dropdowns
            instances.forEach(other => {
                if (other !== inst) other.dropdown.classList.add('hidden');
            });
            if (inst.dropdown.innerHTML.trim() && inst.input.value.trim().length >= 2) {
                inst.dropdown.classList.remove('hidden');
            }
        });

        inst._selectedIndex = -1;
    });

    function highlightItems(dropdown, selectedIndex) {
        dropdown.querySelectorAll('[data-suggestion]').forEach((el, i) => {
            el.style.background = i === selectedIndex ? '#F9FAFB' : 'transparent';
        });
    }

    // ── Close on outside click ──
    document.addEventListener('click', (e) => {
        const clickedInside = instances.some(inst =>
            e.target.closest(`#${inst.form.id}`) || e.target.closest(`#${inst.dropdown.id}`)
        );
        if (!clickedInside) hideAllDropdowns();
    });

    function hideAllDropdowns() {
        instances.forEach(inst => {
            inst.dropdown.classList.add('hidden');
            inst._selectedIndex = -1;
        });
    }

    // ── Fetch suggestions ──
    async function fetchSuggestions(q, inst) {
        try {
            const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(q)}`);
            if (!res.ok) return;
            const data = await res.json();
            renderDropdown(data, q, inst);
        } catch (e) {
            // Silently fail
        }
    }

    // ── Render polished dropdown ──
    function renderDropdown(data, query, inst) {
        const artists = data.artists || [];
        const albums = data.albums || [];

        if (artists.length === 0 && albums.length === 0) {
            inst.dropdown.innerHTML = `
                <div style="padding:16px 20px;color:#9CA3AF;font-size:0.875rem;font-family:'Raleway',sans-serif;text-align:center;">
                    No results for "${escapeHtml(query)}"
                </div>`;
            inst.dropdown.classList.remove('hidden');
            return;
        }

        let html = '';

        // Artists section
        if (artists.length > 0) {
            html += `<div style="padding:8px 16px 4px;font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;font-family:'Raleway',sans-serif;">Artists</div>`;
            html += artists.map(a => {
                const initials = a.name.split(' ').filter(w => w.length > 0).map(w => w[0].toUpperCase()).slice(0, 2).join('');
                const meta = [a.country, a.disambiguation].filter(Boolean).join(' · ');
                return `
                <a href="/results?q=${encodeURIComponent(a.name)}" data-suggestion
                   style="display:flex;align-items:center;gap:12px;padding:10px 16px;text-decoration:none;transition:background 0.15s;"
                   onmouseenter="this.style.background='#F9FAFB'" onmouseleave="this.style.background='transparent'">
                    <div style="width:36px;height:36px;border-radius:50%;background:#FFE5E5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <span style="color:#FF6B6B;font-weight:700;font-size:0.75rem;font-family:'Raleway',sans-serif;">${initials}</span>
                    </div>
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:0.9rem;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${highlightMatch(a.name, query)}</div>
                        ${meta ? `<div style="font-size:0.75rem;color:#9CA3AF;margin-top:1px;">${escapeHtml(meta)}</div>` : ''}
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2" style="flex-shrink:0;"><path d="M9 5l7 7-7 7"/></svg>
                </a>`;
            }).join('');
        }

        // Divider
        if (artists.length > 0 && albums.length > 0) {
            html += `<div style="height:1px;background:#F3F4F6;margin:4px 16px;"></div>`;
        }

        // Albums section
        if (albums.length > 0) {
            html += `<div style="padding:8px 16px 4px;font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#9CA3AF;font-family:'Raleway',sans-serif;">Albums</div>`;
            html += albums.map(a => `
                <a href="/results?q=${encodeURIComponent(a.artist)}" data-suggestion
                   style="display:flex;align-items:center;gap:12px;padding:10px 16px;text-decoration:none;transition:background 0.15s;"
                   onmouseenter="this.style.background='#F9FAFB'" onmouseleave="this.style.background='transparent'">
                    <div style="width:36px;height:36px;border-radius:8px;background:#F3F4F6;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg>
                    </div>
                    <div style="min-width:0;flex:1;">
                        <div style="font-size:0.9rem;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${highlightMatch(a.album, query)}</div>
                        <div style="font-size:0.75rem;color:#9CA3AF;margin-top:1px;">${escapeHtml(a.artist)}</div>
                    </div>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" stroke-width="2" style="flex-shrink:0;"><path d="M9 5l7 7-7 7"/></svg>
                </a>
            `).join('');
        }

        // "Search for..." fallback
        html += `
            <a href="/results?q=${encodeURIComponent(query)}" data-suggestion
               style="display:flex;align-items:center;gap:12px;padding:12px 16px;text-decoration:none;border-top:1px solid #F3F4F6;transition:background 0.15s;"
               onmouseenter="this.style.background='#F9FAFB'" onmouseleave="this.style.background='transparent'">
                <div style="width:36px;height:36px;border-radius:50%;background:#F3F4F6;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="#9CA3AF" stroke-width="2"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg>
                </div>
                <div style="font-size:0.875rem;color:#6B7280;font-family:'Raleway',sans-serif;">
                    Search for <strong style="color:#111827;">"${escapeHtml(query)}"</strong>
                </div>
            </a>`;

        inst.dropdown.innerHTML = html;
        inst.dropdown.classList.remove('hidden');
    }

    // ── Highlight matching text ──
    function highlightMatch(text, query) {
        const escaped = escapeHtml(text);
        const q = escapeHtml(query);
        const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escaped.replace(regex, '<span style="color:#FF6B6B;font-weight:700;">$1</span>');
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ═══════════════════════════════════════════════════
    // "DID YOU MEAN?" — only runs on the results page
    // ═══════════════════════════════════════════════════

    if (window.location.pathname === '/results' || window.location.pathname === '/results.html') {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get('q');
        if (query) {
            checkSpelling(query);
        }
    }

    async function checkSpelling(query) {
        try {
            const res = await fetch(
                `https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=3`,
                { headers: { 'User-Agent': 'findyl/1.0 (https://findyl.co.uk)' } }
            );
            if (!res.ok) return;

            const data = await res.json();
            const artists = data.artists || [];
            if (artists.length === 0) return;

            const topResult = artists[0];
            const topName = topResult.name;
            const queryLower = query.toLowerCase().trim();
            const topLower = topName.toLowerCase().trim();

            // Don't suggest if query already matches
            if (queryLower === topLower) return;
            // Don't suggest for partial matches
            if (topLower.startsWith(queryLower) || topLower.includes(queryLower)) return;
            if (queryLower.startsWith(topLower)) return;

            // Check similarity — only suggest for likely typos
            const similarity = levenshteinSimilarity(queryLower, topLower);
            if (similarity < 0.55) return;

            // Check MB confidence
            const mbScore = topResult.score || 0;
            if (mbScore < 80) return;

            showDidYouMean(topName);
        } catch (e) {
            // Silently fail
        }
    }

    function showDidYouMean(suggestion) {
        if (document.getElementById('did-you-mean')) return;

        const header = document.getElementById('results-header');
        if (!header) return;

        const div = document.createElement('div');
        div.id = 'did-you-mean';
        div.style.cssText = 'margin-bottom:1.5rem;padding:12px 20px;background:#FFF;border:1px solid #F3F4F6;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.04);';
        div.innerHTML = `
            <span style="color:#6B7280;font-size:0.9rem;">Did you mean </span>
            <a href="/results?q=${encodeURIComponent(suggestion)}" 
               style="color:#FF6B6B;font-weight:600;font-size:0.9rem;text-decoration:none;border-bottom:1px dashed #FF6B6B;padding-bottom:1px;">
                ${escapeHtml(suggestion)}
            </a>
            <span style="color:#6B7280;font-size:0.9rem;">?</span>
        `;
        header.after(div);
    }

    // ── Levenshtein distance / similarity ──
    function levenshteinSimilarity(a, b) {
        const dist = levenshteinDistance(a, b);
        const maxLen = Math.max(a.length, b.length);
        if (maxLen === 0) return 1;
        return 1 - dist / maxLen;
    }

    function levenshteinDistance(a, b) {
        const m = a.length;
        const n = b.length;
        const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) dp[i][0] = i;
        for (let j = 0; j <= n; j++) dp[0][j] = j;

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                const cost = a[i - 1] === b[j - 1] ? 0 : 1;
                dp[i][j] = Math.min(
                    dp[i - 1][j] + 1,
                    dp[i][j - 1] + 1,
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[m][n];
    }

})();

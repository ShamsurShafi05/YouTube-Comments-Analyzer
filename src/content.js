// content.js — runs on youtube.com

(function () {
  'use strict';

  const selectedVideos = new Map(); // videoId -> { title, thumbnail }
  let hoverCard = null;
  let hoverTimeout = null;
  let hoverVideoId = null;
  let cachedAnalytics = new Map(); // videoId -> quick analytics

  // ── Bootstrap ──────────────────────────────────────────────
  function init() {
    injectHoverCard();
    injectActionBar();
    injectContextMenu();
    observeDOM();
    decorateAllCards();
  }

  // ── DOM Observer ───────────────────────────────────────────
  function observeDOM() {
    const observer = new MutationObserver(() => decorateAllCards());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Card Decoration ────────────────────────────────────────
  function decorateAllCards() {
    const selectors = [
      'ytd-rich-item-renderer',
      'ytd-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-grid-video-renderer'
    ];

    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(card => {
        if (card.dataset.ytclDecorated) return;
        card.dataset.ytclDecorated = 'true';
        decorateCard(card);
      });
    });
  }

  function getVideoIdFromCard(card) {
    const link = card.querySelector('a#video-title, a#thumbnail, a.ytd-thumbnail');
    if (!link) return null;
    const href = link.href || '';
    const match = href.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function getVideoTitleFromCard(card) {
    const el = card.querySelector('#video-title, #video-title-link');
    return el ? (el.title || el.textContent.trim()) : 'Unknown Video';
  }

  function getThumbnailUrl(videoId) {
    return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
  }

  function decorateCard(card) {
    const videoId = getVideoIdFromCard(card);
    if (!videoId) return;

    const thumbnail = card.querySelector('ytd-thumbnail, #thumbnail');
    if (!thumbnail) return;

    // Make wrapper relative for checkbox positioning
    thumbnail.style.position = 'relative';
    card.classList.add('ytcl-card-wrapper');

    // Inject checkbox
    const cbWrapper = document.createElement('div');
    cbWrapper.className = 'ytcl-checkbox-wrapper';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.title = 'Select for comparison';
    cbWrapper.appendChild(cb);
    thumbnail.appendChild(cbWrapper);

    // Checkbox logic
    cb.addEventListener('change', (e) => {
      e.stopPropagation();
      if (cb.checked) {
        selectedVideos.set(videoId, {
          title: getVideoTitleFromCard(card),
          thumbnail: getThumbnailUrl(videoId)
        });
        card.classList.add('ytcl-selected');
      } else {
        selectedVideos.delete(videoId);
        card.classList.remove('ytcl-selected');
      }
      updateActionBar();
    });

    // ── FIX 1 & 4: Checkbox visibility tied to thumbnail hover, not whole card ──
    // Use the thumbnail element for mouse tracking so checkbox stays visible
    // as long as the mouse is over the video thumbnail area.
    thumbnail.addEventListener('mouseenter', () => {
      cbWrapper.classList.add('ytcl-cb-force-show');
    });
    thumbnail.addEventListener('mouseleave', () => {
      // Only hide if NOT checked (selected checkboxes always stay visible)
      if (!cb.checked) {
        cbWrapper.classList.remove('ytcl-cb-force-show');
      }
    });

    // ── FIX 2: Hover card on the card (whole card hover for preview) ──
    card.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        showHoverCard(videoId, getVideoTitleFromCard(card), card);
      }, 600);
    });

    card.addEventListener('mouseleave', (e) => {
      // Don't hide if moving to the hover card itself
      if (hoverCard && hoverCard.contains(e.relatedTarget)) return;
      clearTimeout(hoverTimeout);
      hideHoverCardDelayed();
    });

    // ── FIX 4: Right-click context menu ──
    card.addEventListener('contextmenu', (e) => {
      const videoData = {
        id: videoId,
        title: getVideoTitleFromCard(card),
        thumbnail: getThumbnailUrl(videoId)
      };
      showContextMenu(e, videoData, cb, card);
    });
  }

  // ── Hover Card ─────────────────────────────────────────────
  function injectHoverCard() {
    hoverCard = document.createElement('div');
    hoverCard.className = 'ytcl-hover-card';
    hoverCard.id = 'ytcl-hover-card';
    document.body.appendChild(hoverCard);

    hoverCard.addEventListener('mouseenter', () => clearTimeout(hoverTimeout));
    hoverCard.addEventListener('mouseleave', () => hideHoverCardDelayed());
  }

  function showHoverCard(videoId, title, anchor) {
    hoverVideoId = videoId;

    const rect = anchor.getBoundingClientRect();
    const cardW = 320;
    const cardH = 350;
    const margin = 16;

    let left = rect.right + 12;
    let top = rect.top + 8;

    if (left + cardW > window.innerWidth - margin) {
      left = rect.left - cardW - 12;
      if (left < margin) left = window.innerWidth - cardW - margin;
    }
    if (left < margin) left = margin;
    if (top + cardH > window.innerHeight - margin) top = window.innerHeight - cardH - margin;
    if (top < margin) top = margin;

    hoverCard.style.left = `${left}px`;
    hoverCard.style.top = `${top}px`;

    hoverCard.innerHTML = `
      <div class="ytcl-hover-card-header">
        <div class="ytcl-hover-card-logo">🔍</div>
        <div class="ytcl-hover-card-title">${escapeHtml(title)}</div>
      </div>
      <div class="ytcl-hover-loading" id="ytcl-hc-body">
        <div class="ytcl-hover-loading-spinner"></div>
        <p>Analyzing comments…</p>
      </div>
    `;

    hoverCard.classList.add('ytcl-visible');

    if (cachedAnalytics.has(videoId)) {
      renderHoverContent(cachedAnalytics.get(videoId), videoId);
      return;
    }

    fetchAndAnalyze(videoId, title).then(data => {
      if (hoverVideoId !== videoId) return;
      cachedAnalytics.set(videoId, data);
      renderHoverContent(data, videoId);
    }).catch(err => {
      if (hoverVideoId !== videoId) return;
      const body = document.getElementById('ytcl-hc-body');
      if (body) body.innerHTML = `<div class="ytcl-hover-error">⚠️ ${escapeHtml(err.message)}</div>`;
    });
  }

  function renderHoverContent(data, videoId) {
    const body = document.getElementById('ytcl-hc-body');
    if (!body || hoverVideoId !== videoId) return;

    const { analytics, commentCount } = data;
    if (!analytics) {
      body.innerHTML = '<div class="ytcl-hover-error">No data returned.</div>';
      return;
    }

    const { sentimentBreakdown, overallScore, toxicComments, complaints, summary } = analytics;
    const total = (sentimentBreakdown?.positive || 0) + (sentimentBreakdown?.neutral || 0) + (sentimentBreakdown?.negative || 0) || 1;
    const posP = Math.round((sentimentBreakdown?.positive || 0) / total * 100);
    const neuP = Math.round((sentimentBreakdown?.neutral || 0) / total * 100);
    const negP = 100 - posP - neuP;

    body.innerHTML = `
      <div class="ytcl-hover-stats">
        <div class="ytcl-stat-pill"><div class="value">${commentCount}</div><div class="label">analyzed</div></div>
        <div class="ytcl-stat-pill"><div class="value" style="color:${scoreColor(overallScore)}">${overallScore?.toFixed(1) ?? '—'}</div><div class="label">quality score</div></div>
        <div class="ytcl-stat-pill"><div class="value" style="color:#fb7185">${toxicComments?.length ?? 0}</div><div class="label">toxic</div></div>
        <div class="ytcl-stat-pill"><div class="value" style="color:#fbbf24">${complaints?.length ?? 0}</div><div class="label">complaints</div></div>
      </div>
      <div class="ytcl-score-bar">
        <span class="ytcl-score-label">Positivity</span>
        <div class="ytcl-score-bar-track"><div class="ytcl-score-bar-fill" style="width:${posP}%"></div></div>
        <span class="ytcl-score-label">${posP}%</span>
      </div>
      <div class="ytcl-sentiment-row">
        <div class="ytcl-sentiment-chip pos">😊 ${posP}%</div>
        <div class="ytcl-sentiment-chip neu">😐 ${neuP}%</div>
        <div class="ytcl-sentiment-chip neg">😠 ${negP}%</div>
      </div>
      ${summary ? `<div class="ytcl-hover-snippet">${escapeHtml(summary.slice(0, 160))}…</div>` : ''}
      <div class="ytcl-hover-footer">Hover ↑ • Click checkbox to compare</div>
    `;
  }

  function hideHoverCardDelayed() {
    hoverTimeout = setTimeout(() => {
      hoverCard.classList.remove('ytcl-visible');
      hoverVideoId = null;
    }, 300);
  }

  // ── Action Bar ─────────────────────────────────────────────
  function injectActionBar() {
    const bar = document.createElement('div');
    bar.id = 'ytcl-action-bar';
    bar.innerHTML = `
      <div class="ytcl-bar-count"><span id="ytcl-sel-count">0</span> selected</div>
      <button id="ytcl-btn-analyze">🔬 Analyze Selected</button>
      <button id="ytcl-btn-clear">✕ Clear</button>
    `;
    document.body.appendChild(bar);

    document.getElementById('ytcl-btn-analyze').addEventListener('click', openSidePanel);
    document.getElementById('ytcl-btn-clear').addEventListener('click', clearSelection);
  }

  function updateActionBar() {
    const bar = document.getElementById('ytcl-action-bar');
    const countEl = document.getElementById('ytcl-sel-count');
    const count = selectedVideos.size;
    countEl.textContent = count;
    if (count > 0) bar.classList.add('ytcl-bar-visible');
    else bar.classList.remove('ytcl-bar-visible');
  }

  function clearSelection() {
    selectedVideos.clear();
    document.querySelectorAll('.ytcl-card-wrapper.ytcl-selected').forEach(el => {
      el.classList.remove('ytcl-selected');
      const cb = el.querySelector('.ytcl-checkbox-wrapper input');
      if (cb) cb.checked = false;
      // Also remove force-show since it's now unchecked
      const cbw = el.querySelector('.ytcl-checkbox-wrapper');
      if (cbw) cbw.classList.remove('ytcl-cb-force-show');
    });
    updateActionBar();
  }

  async function openSidePanel(videoOverride) {
    // videoOverride: single video object { id, title, thumbnail } from context menu
    let videos;
    if (videoOverride && videoOverride.id) {
      // Single video analyze — temporarily add it if not already selected
      videos = [videoOverride];
    } else {
      videos = Array.from(selectedVideos.entries()).map(([id, meta]) => ({ id, ...meta }));
    }
    await sendMessage({ type: 'SET_STORAGE', data: { ytcl_selected: videos, ytcl_cache: Object.fromEntries(cachedAnalytics) } });
    await sendMessage({ type: 'OPEN_SIDE_PANEL' });
  }

  // ── FIX 4: Context Menu ────────────────────────────────────
  function injectContextMenu() {
    const menu = document.createElement('div');
    menu.id = 'ytcl-context-menu';
    menu.innerHTML = `
      <div class="ytcl-ctx-header">
        <span class="ytcl-ctx-logo">🔍</span>
        <span class="ytcl-ctx-label">YT Comment Lens</span>
      </div>
      <div class="ytcl-ctx-item" id="ytcl-ctx-analyze">
        <span class="ytcl-ctx-item-icon">🔬</span> Analyze this video
      </div>
      <div class="ytcl-ctx-item" id="ytcl-ctx-select">
        <span class="ytcl-ctx-item-icon">☑️</span> <span id="ytcl-ctx-select-label">Select for comparison</span>
      </div>
      <div class="ytcl-ctx-divider"></div>
      <div class="ytcl-ctx-item ytcl-ctx-muted" id="ytcl-ctx-dismiss">
        <span class="ytcl-ctx-item-icon">✕</span> Dismiss
      </div>
    `;
    document.body.appendChild(menu);

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target)) hideContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideContextMenu();
    });

    document.getElementById('ytcl-ctx-dismiss').addEventListener('click', hideContextMenu);
  }

  let ctxMenuData = null; // { videoData, cb, card }

  function showContextMenu(e, videoData, cb, card) {
    e.preventDefault();
    e.stopPropagation();

    ctxMenuData = { videoData, cb, card };

    const menu = document.getElementById('ytcl-context-menu');
    const isSelected = selectedVideos.has(videoData.id);

    // Update select label
    document.getElementById('ytcl-ctx-select-label').textContent = isSelected
      ? 'Deselect video'
      : 'Select for comparison';

    // Position menu
    const menuW = 210;
    const menuH = 140;
    const margin = 8;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuW > window.innerWidth - margin) x = window.innerWidth - menuW - margin;
    if (y + menuH > window.innerHeight - margin) y = window.innerHeight - menuH - margin;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.classList.add('ytcl-ctx-visible');

    // Wire up actions fresh each time
    const analyzeBtn = document.getElementById('ytcl-ctx-analyze');
    const selectBtn = document.getElementById('ytcl-ctx-select');

    const newAnalyze = analyzeBtn.cloneNode(true);
    analyzeBtn.parentNode.replaceChild(newAnalyze, analyzeBtn);
    newAnalyze.addEventListener('click', () => {
      hideContextMenu();
      openSidePanel(ctxMenuData.videoData);
    });

    const newSelect = selectBtn.cloneNode(true);
    selectBtn.parentNode.replaceChild(newSelect, selectBtn);
    newSelect.addEventListener('click', () => {
      hideContextMenu();
      const { videoData: vd, cb: checkbox, card: c } = ctxMenuData;
      if (selectedVideos.has(vd.id)) {
        selectedVideos.delete(vd.id);
        c.classList.remove('ytcl-selected');
        checkbox.checked = false;
        const cbw = c.querySelector('.ytcl-checkbox-wrapper');
        if (cbw) cbw.classList.remove('ytcl-cb-force-show');
      } else {
        selectedVideos.set(vd.id, { title: vd.title, thumbnail: vd.thumbnail });
        c.classList.add('ytcl-selected');
        checkbox.checked = true;
        const cbw = c.querySelector('.ytcl-checkbox-wrapper');
        if (cbw) cbw.classList.add('ytcl-cb-force-show');
      }
      updateActionBar();
    });
  }

  function hideContextMenu() {
    const menu = document.getElementById('ytcl-context-menu');
    if (menu) menu.classList.remove('ytcl-ctx-visible');
    ctxMenuData = null;
  }

  // ── API Helpers ────────────────────────────────────────────
  async function fetchAndAnalyze(videoId, title) {
    const stored = await sendMessage({ type: 'GET_STORAGE', keys: ['ytApiKey', 'ytcl_maxComments'] });
    const apiKey = stored.ytApiKey;
    if (!apiKey) throw new Error('No YouTube API key set. Open the extension popup.');

    const maxResults = stored.ytcl_maxComments || 60;

    const commentsRes = await sendMessage({ type: 'FETCH_COMMENTS', videoId, apiKey, maxResults });
    if (!commentsRes.ok) throw new Error(commentsRes.error);

    const comments = commentsRes.data;
    if (!comments.length) return { analytics: null, commentCount: 0, comments: [] };

    const analysisRes = await sendMessage({ type: 'ANALYZE_COMMENTS', comments, videoTitle: title });
    if (!analysisRes.ok) throw new Error(analysisRes.error);

    return { analytics: analysisRes.data, commentCount: comments.length, comments, title, videoId };
  }

  function sendMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, res => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(res);
      });
    });
  }

  // ── Utils ──────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function scoreColor(score) {
    if (score >= 7) return '#34d399';
    if (score >= 4) return '#fbbf24';
    return '#fb7185';
  }

  // ── Init ───────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// sidepanel.js

const app = document.getElementById('app');
let state = {
  videos: [],        // { id, title, thumbnail }
  results: {},       // videoId -> { analytics, comments, commentCount, error }
  activeVideoId: null,
  activeTab: 'overview',
  loading: {},       // videoId -> bool
};

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-refresh').addEventListener('click', () => loadData(true));
  loadData(false);
});

async function loadData(force) {
  const stored = await msg({ type: 'GET_STORAGE', keys: ['ytcl_selected', 'ytcl_cache'] });
  const videos = stored.ytcl_selected || [];

  if (!videos.length) {
    render({ type: 'empty' });
    return;
  }

  state.videos = videos;
  if (!state.activeVideoId) state.activeVideoId = videos[0].id;

  // Seed cache
  const cache = stored.ytcl_cache || {};
  for (const [id, val] of Object.entries(cache)) {
    if (!state.results[id]) state.results[id] = val;
  }

  // Kick off fetches for missing results
  for (const v of videos) {
    if (!state.results[v.id] || force) {
      state.loading[v.id] = true;
    }
  }

  renderFull();

  for (const v of videos) {
    if (state.loading[v.id]) {
      fetchVideo(v);
    }
  }
}

async function fetchVideo(video) {
  const stored = await msg({ type: 'GET_STORAGE', keys: ['ytApiKey', 'ytcl_maxComments'] });
  const apiKey = stored.ytApiKey;
  const maxResults = stored.ytcl_maxComments || 60;

  if (!apiKey) {
    state.results[video.id] = { error: 'No YouTube API key. Set it in the extension popup.' };
    state.loading[video.id] = false;
    rerenderTabs();
    if (state.activeVideoId === video.id) rerenderContent();
    return;
  }

  try {
    const commentsRes = await msg({ type: 'FETCH_COMMENTS', videoId: video.id, apiKey, maxResults });
    if (!commentsRes.ok) throw new Error(commentsRes.error);

    const comments = commentsRes.data;
    const analysisRes = await msg({ type: 'ANALYZE_COMMENTS', comments, videoTitle: video.title });
    if (!analysisRes.ok) throw new Error(analysisRes.error);

    state.results[video.id] = {
      analytics: analysisRes.data,
      comments,
      commentCount: comments.length,
    };
  } catch (e) {
    state.results[video.id] = { error: e.message };
  }

  state.loading[video.id] = false;
  rerenderTabs();
  if (state.activeVideoId === video.id) rerenderContent();
}

// ── Render ─────────────────────────────────────────────────────────────────
function render(view) {
  if (view.type === 'empty') {
    app.innerHTML = `
      <div class="state-screen">
        <div class="emoji">🎬</div>
        <p>No videos selected yet.<br>Go to YouTube, hover over thumbnails and check videos, then click <strong>"Analyze Selected"</strong>.</p>
      </div>`;
    return;
  }
  renderFull();
}

function renderFull() {
  app.innerHTML = `
    <div id="video-tabs-container"></div>
    <div id="content-container"></div>
  `;
  rerenderTabs();
  rerenderContent();
}

function rerenderTabs() {
  const container = document.getElementById('video-tabs-container');
  if (!container) return;

  const tabs = state.videos.map(v => {
    const isLoading = state.loading[v.id];
    const hasError = state.results[v.id]?.error;
    const isActive = v.id === state.activeVideoId;
    const icon = isLoading ? '⏳' : hasError ? '⚠️' : '';
    return `
      <div class="video-tab ${isActive ? 'active' : ''} ${isLoading ? 'loading-tab' : ''}"
           data-vid="${v.id}">
        <img src="${v.thumbnail}" onerror="this.style.display='none'">
        <span>${icon}${escHtml(v.title)}</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="video-tabs">${tabs}</div>`;

  container.querySelectorAll('.video-tab').forEach(el => {
    el.addEventListener('click', () => {
      state.activeVideoId = el.dataset.vid;
      state.activeTab = 'overview';
      rerenderTabs();
      rerenderContent();
    });
  });
}

function rerenderContent() {
  const container = document.getElementById('content-container');
  if (!container) return;

  const vid = state.activeVideoId;
  const isLoading = state.loading[vid];
  const result = state.results[vid];
  const videoMeta = state.videos.find(v => v.id === vid);

  if (isLoading) {
    container.innerHTML = `
      <div class="state-screen">
        <div class="spinner"></div>
        <p>Fetching &amp; analyzing comments for<br><strong>${escHtml(videoMeta?.title || vid)}</strong>…</p>
      </div>`;
    return;
  }

  if (!result) {
    container.innerHTML = `<div class="state-screen"><p>Select a video tab above.</p></div>`;
    return;
  }

  if (result.error) {
    container.innerHTML = `
      <div class="state-screen">
        <div class="emoji">😕</div>
        <p style="color:#fb7185">${escHtml(result.error)}</p>
      </div>`;
    return;
  }

  const { analytics, comments, commentCount } = result;

  // Inner navigation tabs
  const tabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'top', label: '⭐ Top' },
    { id: 'toxic', label: `🚨 Toxic ${analytics.toxicComments?.length ? `(${analytics.toxicComments.length})` : ''}` },
    { id: 'complaints', label: `⚠️ Issues ${analytics.complaints?.length ? `(${analytics.complaints.length})` : ''}` },
    { id: 'engaging', label: '🔥 Thread' },
  ];

  const tabHtml = tabs.map(t =>
    `<div class="inner-tab ${state.activeTab === t.id ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>`
  ).join('');

  container.innerHTML = `
    <div class="inner-tabs">${tabHtml}</div>
    <div id="tab-content"></div>
  `;

  container.querySelectorAll('.inner-tab').forEach(el => {
    el.addEventListener('click', () => {
      state.activeTab = el.dataset.tab;
      rerenderContent();
    });
  });

  renderTabContent(analytics, comments, commentCount);
}

function renderTabContent(analytics, comments, commentCount) {
  const el = document.getElementById('tab-content');
  if (!el) return;

  switch (state.activeTab) {
    case 'overview': el.innerHTML = renderOverview(analytics, commentCount); break;
    case 'top': el.innerHTML = renderTopComments(analytics, comments); break;
    case 'toxic': el.innerHTML = renderToxic(analytics, comments); break;
    case 'complaints': el.innerHTML = renderComplaints(analytics, comments); break;
    case 'engaging': el.innerHTML = renderEngaging(analytics, comments); break;
  }
}

// ── Overview ────────────────────────────────────────────────────────────────
function renderOverview(a, commentCount) {
  const sb = a.sentimentBreakdown || {};
  const total = (sb.positive || 0) + (sb.neutral || 0) + (sb.negative || 0) || 1;
  const posP = Math.round((sb.positive || 0) / total * 100);
  const neuP = Math.round((sb.neutral || 0) / total * 100);
  const negP = 100 - posP - neuP;
  const score = a.overallScore ?? 0;
  const scoreClass = score >= 7 ? 'score-high' : score >= 4 ? 'score-mid' : 'score-low';
  const scoreColor = score >= 7 ? '#34d399' : score >= 4 ? '#fbbf24' : '#fb7185';

  return `
    <div class="section">
      <div class="stats-grid">
        <div class="stat-box">
          <div class="val" style="color:${scoreColor}">${score.toFixed(1)}</div>
          <div class="lbl">Quality Score</div>
        </div>
        <div class="stat-box">
          <div class="val">${commentCount}</div>
          <div class="lbl">Comments Analyzed</div>
        </div>
        <div class="stat-box">
          <div class="val" style="color:#fb7185">${(a.toxicComments || []).length}</div>
          <div class="lbl">Toxic Found</div>
        </div>
      </div>

      <div class="summary-card">
        <div class="summary-meta">
          <span class="meta-chip ${scoreClass}">Score: ${score.toFixed(1)}/10</span>
          <span class="meta-chip neutral">${commentCount} analyzed</span>
          ${(a.complaints || []).length > 0 ? `<span class="meta-chip score-low">⚠️ ${a.complaints.length} complaints</span>` : ''}
        </div>
        <div class="summary-text">${escHtml(a.summary || 'No summary available.')}</div>
      </div>

      <div class="sentiment-bar-wrap">
        <div class="sentiment-bar">
          <div class="pos" style="width:${posP}%"></div>
          <div class="neu" style="width:${neuP}%"></div>
          <div class="neg" style="width:${negP}%"></div>
        </div>
        <div class="sentiment-legend">
          <div class="legend-item"><div class="legend-dot pos"></div>Positive ${posP}%</div>
          <div class="legend-item"><div class="legend-dot neu"></div>Neutral ${neuP}%</div>
          <div class="legend-item"><div class="legend-dot neg"></div>Negative ${negP}%</div>
        </div>
      </div>
    </div>

    ${(a.topThemes || []).length ? `
    <div class="section">
      <div class="section-header">
        <span class="section-icon">💡</span>
        <span class="section-title">Top Themes</span>
      </div>
      <div class="theme-pills">
        ${a.topThemes.map(t => `<div class="theme-pill">${escHtml(t)}</div>`).join('')}
      </div>
    </div>` : ''}
  `;
}

// ── Top Comments ───────────────────────────────────────────────────────────
function renderTopComments(a, comments) {
  const tops = (a.topComments || []);
  if (!tops.length) return `<div class="empty-state">No top comments identified.</div>`;

  const cards = tops.map(t => {
    const c = comments[t.index - 1];
    if (!c) return '';
    const badgeClass = `badge-${t.category || 'insightful'}`;
    return `
      <div class="comment-card top-comment">
        <div class="comment-card-header">
          <div class="comment-avatar">${c.author?.[0]?.toUpperCase() || '?'}</div>
          <div class="comment-meta">
            <div class="comment-author">${escHtml(c.author || 'Anonymous')}</div>
            <div class="comment-stats">👍 ${c.likes || 0} · 💬 ${c.replyCount || 0} replies</div>
          </div>
          <span class="comment-badge ${badgeClass}">${t.category || 'top'}</span>
        </div>
        <div class="comment-text">${escHtml(cleanText(c.text))}</div>
        <div class="comment-reason">✦ ${escHtml(t.reason)}</div>
      </div>`;
  }).join('');

  return `<div class="section">
    <div class="section-header">
      <span class="section-icon">⭐</span>
      <span class="section-title">Best Comments</span>
      <span class="section-badge">${tops.length}</span>
    </div>
    ${cards}
  </div>`;
}

// ── Toxic ──────────────────────────────────────────────────────────────────
function renderToxic(a, comments) {
  const toxics = a.toxicComments || [];
  if (!toxics.length) return `
    <div class="section">
      <div class="empty-state">
        <div style="font-size:28px;margin-bottom:8px">🌟</div>
        No toxic comments detected — this looks like a healthy comment section!
      </div>
    </div>`;

  const cards = toxics.map(t => {
    const c = comments[t.index - 1];
    if (!c) return '';
    const badgeClass = `badge-${t.severity || 'medium'}`;
    return `
      <div class="comment-card toxic-comment">
        <div class="comment-card-header">
          <div class="comment-avatar">${c.author?.[0]?.toUpperCase() || '?'}</div>
          <div class="comment-meta">
            <div class="comment-author">${escHtml(c.author || 'Anonymous')}</div>
            <div class="comment-stats">👍 ${c.likes || 0}</div>
          </div>
          <span class="comment-badge ${badgeClass}">${t.severity || 'med'}</span>
        </div>
        <div class="comment-text">${escHtml(cleanText(c.text))}</div>
        <div class="comment-reason">⚠️ ${escHtml(t.reason)}</div>
      </div>`;
  }).join('');

  return `<div class="section">
    <div class="section-header">
      <span class="section-icon">🚨</span>
      <span class="section-title">Toxic / Negative</span>
      <span class="section-badge">${toxics.length}</span>
    </div>
    ${cards}
  </div>`;
}

// ── Complaints ─────────────────────────────────────────────────────────────
function renderComplaints(a, comments) {
  const complaints = a.complaints || [];
  if (!complaints.length) return `
    <div class="section">
      <div class="empty-state">
        <div style="font-size:28px;margin-bottom:8px">✅</div>
        No error reports or complaints detected.
      </div>
    </div>`;

  const cards = complaints.map(t => {
    const c = comments[t.index - 1];
    if (!c) return '';
    return `
      <div class="comment-card complaint-comment">
        <div class="comment-card-header">
          <div class="comment-avatar">${c.author?.[0]?.toUpperCase() || '?'}</div>
          <div class="comment-meta">
            <div class="comment-author">${escHtml(c.author || 'Anonymous')}</div>
            <div class="comment-stats">👍 ${c.likes || 0}</div>
          </div>
          <span class="comment-badge badge-medium">issue</span>
        </div>
        <div class="comment-text">${escHtml(cleanText(c.text))}</div>
        <div class="comment-reason">🐛 ${escHtml(t.issue)}</div>
      </div>`;
  }).join('');

  return `<div class="section">
    <div class="section-header">
      <span class="section-icon">⚠️</span>
      <span class="section-title">Complaints &amp; Error Reports</span>
      <span class="section-badge">${complaints.length}</span>
    </div>
    ${cards}
  </div>`;
}

// ── Most Engaging Thread ───────────────────────────────────────────────────
function renderEngaging(a, comments) {
  const eng = a.mostEngagingThread;
  if (!eng) return `<div class="empty-state">No engaging thread identified.</div>`;

  const c = comments[eng.index - 1];
  if (!c) return `<div class="empty-state">Comment data unavailable.</div>`;

  const repliesHtml = (c.replies || []).slice(0, 5).map(r => `
    <div style="margin-left:16px;padding:8px 12px;border-left:2px solid rgba(96,165,250,0.3);margin-bottom:6px;">
      <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-bottom:3px">${escHtml(r.author)} · 👍 ${r.likes}</div>
      <div style="font-size:12px;color:rgba(255,255,255,0.75)">${escHtml(cleanText(r.text))}</div>
    </div>`).join('');

  return `<div class="section">
    <div class="section-header">
      <span class="section-icon">🔥</span>
      <span class="section-title">Most Engaging Thread</span>
    </div>
    <div class="comment-card engaging-comment">
      <div class="comment-card-header">
        <div class="comment-avatar">${c.author?.[0]?.toUpperCase() || '?'}</div>
        <div class="comment-meta">
          <div class="comment-author">${escHtml(c.author || 'Anonymous')}</div>
          <div class="comment-stats">👍 ${c.likes || 0} · 💬 ${c.replyCount || 0} replies</div>
        </div>
      </div>
      <div class="comment-text">${escHtml(cleanText(c.text))}</div>
      <div class="comment-reason">🔥 ${escHtml(eng.reason)}</div>
    </div>
    ${repliesHtml ? `
    <div style="margin-top:8px">
      <div style="font-size:11px;color:rgba(255,255,255,0.35);margin-bottom:6px;padding-left:4px">Top replies:</div>
      ${repliesHtml}
    </div>` : ''}
  </div>`;
}

// ── Utils ──────────────────────────────────────────────────────────────────
function msg(data) {
  return new Promise((res, rej) => {
    chrome.runtime.sendMessage(data, resp => {
      if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
      else res(resp);
    });
  });
}

function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cleanText(html) {
  return (html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim();
}

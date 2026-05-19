// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const ytKeyEl      = document.getElementById('yt-key');
  const maxEl        = document.getElementById('max-comments');
  const statusEl     = document.getElementById('status');
  const groqListEl   = document.getElementById('groq-key-list');
  const groqNewKeyEl = document.getElementById('groq-new-key');
  const groqAddBtn   = document.getElementById('groq-add-btn');

  // In-memory copy of the key array while popup is open
  let groqKeys = [];
  let activeKeyIndex = 0;

  // ── Load saved values ──────────────────────────────────────
  chrome.storage.local.get(['ytApiKey', 'groqKeys', 'groqKeyIndex', 'ytcl_maxComments'], (data) => {
    if (data.ytApiKey) ytKeyEl.value = data.ytApiKey;
    if (data.ytcl_maxComments) maxEl.value = data.ytcl_maxComments;

    groqKeys = Array.isArray(data.groqKeys) ? data.groqKeys : [];
    activeKeyIndex = data.groqKeyIndex || 0;
    renderKeyList();
  });

  // ── Render saved Groq key list ─────────────────────────────
  function renderKeyList() {
    groqListEl.innerHTML = '';
    if (!groqKeys.length) {
      groqListEl.innerHTML = '<p style="font-size:11px;color:rgba(255,255,255,0.25);padding:4px 2px">No keys added yet.</p>';
      return;
    }
    groqKeys.forEach((key, i) => {
      const isActive = (i === activeKeyIndex % groqKeys.length);
      const row = document.createElement('div');
      row.className = 'groq-key-row' + (isActive ? ' active-key' : '');

      // Masked display: show first 8 and last 4 chars
      const masked = key.length > 14
        ? key.slice(0, 8) + '••••••••' + key.slice(-4)
        : '••••••••';

      row.innerHTML = `
        <span class="groq-key-index">#${i + 1}</span>
        <span class="groq-key-text" title="${masked}">${masked}</span>
        ${isActive ? '<span class="groq-key-badge">active</span>' : ''}
        <button class="groq-key-remove" data-index="${i}" title="Remove key">✕</button>
      `;
      groqListEl.appendChild(row);
    });

    // Remove buttons
    groqListEl.querySelectorAll('.groq-key-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index);
        groqKeys.splice(idx, 1);
        // Adjust active index if needed
        if (activeKeyIndex >= groqKeys.length) activeKeyIndex = 0;
        renderKeyList();
      });
    });
  }

  // ── Add new Groq key ───────────────────────────────────────
  function addGroqKey() {
    const newKey = groqNewKeyEl.value.trim();
    if (!newKey) { showStatus('Paste a Groq key first', true); return; }
    if (groqKeys.includes(newKey)) { showStatus('That key is already added', true); return; }
    groqKeys.push(newKey);
    groqNewKeyEl.value = '';
    renderKeyList();
    showStatus(`Key #${groqKeys.length} added`, false);
  }

  groqAddBtn.addEventListener('click', addGroqKey);
  groqNewKeyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') addGroqKey(); });

  // ── Eye toggle for YT key ──────────────────────────────────
  document.getElementById('yt-eye').addEventListener('click', () => {
    ytKeyEl.type = ytKeyEl.type === 'password' ? 'text' : 'password';
  });

  // ── Save ───────────────────────────────────────────────────
  document.getElementById('save-btn').addEventListener('click', () => {
    const ytKey = ytKeyEl.value.trim();
    const max   = parseInt(maxEl.value) || 60;

    if (!ytKey)          { showStatus('YouTube API key is required', true); return; }
    if (!groqKeys.length){ showStatus('Add at least one Groq API key', true); return; }

    const dataToSave = {
      ytApiKey: ytKey,
      groqKeys,
      groqKeyIndex: activeKeyIndex % groqKeys.length,
      ytcl_maxComments: max
    };

    chrome.storage.local.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, true);
        return;
      }
      showStatus(`✓ Saved! ${groqKeys.length} Groq key${groqKeys.length > 1 ? 's' : ''} active`, false);
    });
  });

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (isError ? ' error' : '');
    if (!isError) setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }
});

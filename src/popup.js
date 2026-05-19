// popup.js
document.addEventListener('DOMContentLoaded', () => {
  const ytKeyEl = document.getElementById('yt-key');
  const groqKeyEl = document.getElementById('anthropic-key');
  const maxEl = document.getElementById('max-comments');
  const statusEl = document.getElementById('status');

  // Load saved values
  chrome.storage.local.get(['ytApiKey', 'groqKey', 'ytcl_maxComments'], (data) => {
    console.log('Loaded from storage:', data);
    if (data.ytApiKey) ytKeyEl.value = data.ytApiKey;
    if (data.groqKey) groqKeyEl.value = data.groqKey;
    if (data.ytcl_maxComments) maxEl.value = data.ytcl_maxComments;
  });

  // Eye toggles
  document.getElementById('yt-eye').addEventListener('click', () => {
    ytKeyEl.type = ytKeyEl.type === 'password' ? 'text' : 'password';
  });
  document.getElementById('ant-eye').addEventListener('click', () => {
    groqKeyEl.type = groqKeyEl.type === 'password' ? 'text' : 'password';
  });

  // Save
  document.getElementById('save-btn').addEventListener('click', () => {
    const ytKey = ytKeyEl.value.trim();
    const groqKey = groqKeyEl.value.trim();
    const max = parseInt(maxEl.value) || 60;

    if (!ytKey) { showStatus('YouTube API key is required', true); return; }
    if (!groqKey) { showStatus('Groq API key is required', true); return; }

    const dataToSave = { ytApiKey: ytKey, groqKey: groqKey, ytcl_maxComments: max };
    console.log('Saving:', dataToSave);

    chrome.storage.local.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, true);
        console.error('Storage error:', chrome.runtime.lastError);
        return;
      }

      // Verify it actually saved
      chrome.storage.local.get(['ytApiKey', 'groqKey'], (verify) => {
        console.log('Verified saved data:', verify);
        if (verify.groqKey) {
          showStatus('✓ Settings saved!', false);
        } else {
          showStatus('Save failed silently!', true);
        }
      });
    });
  });

  function showStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.className = 'status' + (isError ? ' error' : '');
    if (!isError) setTimeout(() => { statusEl.textContent = ''; }, 2500);
  }
});
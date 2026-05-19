// background.js — Service Worker

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OPEN_SIDE_PANEL') {
    chrome.sidePanel.open({ tabId: sender.tab.id });
    sendResponse({ ok: true });
  }

  if (message.type === 'FETCH_COMMENTS') {
    fetchComments(message.videoId, message.apiKey, message.maxResults)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (message.type === 'ANALYZE_COMMENTS') {
    analyzeWithGroq(message.comments, message.videoTitle)
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // async
  }

  if (message.type === 'GET_STORAGE') {
    chrome.storage.local.get(message.keys, result => sendResponse(result));
    return true;
  }

  if (message.type === 'SET_STORAGE') {
    chrome.storage.local.set(message.data, () => sendResponse({ ok: true }));
    return true;
  }
});

async function fetchComments(videoId, apiKey, maxResults = 100) {
  const allComments = [];
  let pageToken = '';
  const perPage = Math.min(maxResults, 100);

  while (allComments.length < maxResults) {
    const url = new URL('https://www.googleapis.com/youtube/v3/commentThreads');
    url.searchParams.set('part', 'snippet,replies');
    url.searchParams.set('videoId', videoId);
    url.searchParams.set('maxResults', String(perPage));
    url.searchParams.set('order', 'relevance');
    url.searchParams.set('key', apiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const errBody = await res.json();
      throw new Error(errBody?.error?.message || `API error ${res.status}`);
    }
    const json = await res.json();

    for (const item of (json.items || [])) {
      const top = item.snippet.topLevelComment.snippet;
      allComments.push({
        id: item.id,
        text: top.textDisplay,
        author: top.authorDisplayName,
        likes: top.likeCount,
        replyCount: item.snippet.totalReplyCount,
        publishedAt: top.publishedAt,
        replies: (item.replies?.comments || []).map(r => ({
          text: r.snippet.textDisplay,
          author: r.snippet.authorDisplayName,
          likes: r.snippet.likeCount,
        }))
      });
    }

    pageToken = json.nextPageToken;
    if (!pageToken || allComments.length >= maxResults) break;
  }

  return allComments.slice(0, maxResults);
}

async function analyzeWithGroq(comments, videoTitle) {
  const stored = await new Promise(res =>
    chrome.storage.local.get(['groqKey'], res)
  );
  const groqKey = stored.groqKey; // reusing same storage key, no popup changes needed
  if (!groqKey) throw new Error('No Groq API key set. Open the extension popup.');

  const commentTexts = comments
    .slice(0, 80)
    .map((c, i) => `[${i + 1}] (👍${c.likes}) ${c.author}: ${c.text.replace(/<[^>]+>/g, '').slice(0, 300)}`)
    .join('\n');

  const prompt = `You are analyzing YouTube comments for the video: "${videoTitle}".

Here are up to 80 comments (format: [index] (likes) author: text):
${commentTexts}

Return ONLY a valid JSON object (no markdown, no explanation) with this exact structure:
{
  "summary": "2-3 sentence overview of overall comment sentiment and themes",
  "sentimentBreakdown": { "positive": 0, "neutral": 0, "negative": 0 },
  "topComments": [
    { "index": 1, "reason": "why it's notable", "category": "insightful|funny|supportive" }
  ],
  "toxicComments": [
    { "index": 1, "reason": "why it's toxic/negative", "severity": "low|medium|high" }
  ],
  "complaints": [
    { "index": 1, "issue": "short description of the complaint/error report" }
  ],
  "mostEngagingThread": {
    "index": 1,
    "reason": "why this thread is most engaging",
    "replyCount": 0
  },
  "topThemes": ["theme1", "theme2", "theme3"],
  "overallScore": 7.5
}

Rules:
- topComments: pick 3-5 best
- toxicComments: pick up to 5 (empty array if none)
- complaints: pick up to 5 comments reporting bugs, errors, problems
- sentimentBreakdown must sum to ${comments.length > 80 ? 80 : comments.length}
- overallScore is 0-10 rating of comment section quality/positivity
- index refers to the [index] numbers above`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',  // or 'mixtral-8x7b-32768'
      max_tokens: 1500,
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: 'You are a JSON-only API. You never output markdown, explanations, or text outside of the JSON object.'
        },
        { role: 'user', content: prompt }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err?.error?.message || `Groq API error ${res.status}`);
  }

  const json = await res.json();
  const raw = json.choices?.[0]?.message?.content || '{}';
  const clean = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}
const axios = require('axios');

const PLATFORMS = ['twitch', 'tiktok', 'youtube'];
const PLATFORM_LABELS = {
  twitch: 'Twitch',
  tiktok: 'TikTok',
  youtube: 'YouTube'
};

function trimTrailingSlashes(value) {
  return value.replace(/\/+$/, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaContent(html, attributeName, attributeValue) {
  const escapedValue = escapeRegExp(attributeValue);
  const primary = new RegExp(`<meta[^>]+${attributeName}=["']${escapedValue}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i');
  const secondary = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attributeName}=["']${escapedValue}["'][^>]*>`, 'i');
  const match = html.match(primary) || html.match(secondary);

  return match ? decodeHtmlEntities(match[1].trim()) : '';
}

function cleanTitle(title) {
  return title
    .replace(/\s*-\s*Twitch\s*$/i, '')
    .replace(/\s*-\s*YouTube\s*$/i, '')
    .replace(/\s*[|·]\s*TikTok.*$/i, '')
    .trim();
}

async function fetchPage(url) {
  const response = await axios.get(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36'
    },
    maxRedirects: 5,
    timeout: 15000,
    validateStatus: () => true
  });

  return {
    status: response.status,
    html: typeof response.data === 'string' ? response.data : '',
    finalUrl: response.request?.res?.responseUrl || url
  };
}

function buildOfflineResult(platform, channel, extra = {}) {
  return {
    platform,
    isLive: false,
    checkedAt: new Date().toISOString(),
    liveUrl: channel?.url || '',
    title: '',
    ...extra
  };
}

function normaliseTwitchInput(rawInput) {
  let handle = String(rawInput || '').trim();

  if (!handle) {
    throw new Error('Please provide a Twitch channel URL.');
  }

  if (/^https?:\/\//i.test(handle)) {
    const url = new URL(handle);
    if (!/twitch\.tv$/i.test(url.hostname) && !/www\.twitch\.tv$/i.test(url.hostname)) {
      throw new Error('That is not a valid Twitch URL.');
    }

    handle = url.pathname.split('/').filter(Boolean)[0] || '';
  }

  handle = handle.replace(/^@/, '').toLowerCase();

  if (!/^[a-z0-9_]{3,25}$/i.test(handle)) {
    throw new Error('That Twitch channel URL is not valid.');
  }

  return {
    platform: 'twitch',
    identifier: handle,
    url: `https://www.twitch.tv/${handle}`
  };
}

function normaliseTikTokInput(rawInput) {
  let handle = String(rawInput || '').trim();

  if (!handle) {
    throw new Error('Please provide a TikTok channel URL.');
  }

  if (/^https?:\/\//i.test(handle)) {
    const url = new URL(handle);
    if (!/tiktok\.com$/i.test(url.hostname) && !/www\.tiktok\.com$/i.test(url.hostname)) {
      throw new Error('That is not a valid TikTok URL.');
    }

    handle = url.pathname.split('/').filter(Boolean)[0] || '';
  }

  handle = handle.replace(/^@/, '');

  if (!/^[A-Za-z0-9._]{2,64}$/.test(handle)) {
    throw new Error('That TikTok channel URL is not valid.');
  }

  return {
    platform: 'tiktok',
    identifier: handle.toLowerCase(),
    url: `https://www.tiktok.com/@${handle}`
  };
}

function normaliseYouTubeInput(rawInput) {
  let value = String(rawInput || '').trim();

  if (!value) {
    throw new Error('Please provide a YouTube channel URL.');
  }

  if (!/^https?:\/\//i.test(value)) {
    if (value.startsWith('@')) {
      value = `https://www.youtube.com/${value}`;
    } else if (/^UC[\w-]{20,}$/i.test(value)) {
      value = `https://www.youtube.com/channel/${value}`;
    } else {
      value = `https://www.youtube.com/@${value}`;
    }
  }

  const url = new URL(value);
  if (!/youtube\.com$/i.test(url.hostname) && !/www\.youtube\.com$/i.test(url.hostname)) {
    throw new Error('That is not a valid YouTube URL.');
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 0) {
    throw new Error('That YouTube channel URL is not valid.');
  }

  let canonicalPath = '';
  let identifier = '';

  if (parts[0].startsWith('@')) {
    canonicalPath = parts[0];
    identifier = parts[0].toLowerCase();
  } else if (parts.length >= 2 && ['channel', 'c', 'user'].includes(parts[0].toLowerCase())) {
    canonicalPath = `${parts[0]}/${parts[1]}`;
    identifier = canonicalPath;
  } else {
    throw new Error('Please use a YouTube channel URL, such as /@handle or /channel/....');
  }

  return {
    platform: 'youtube',
    identifier,
    url: `https://www.youtube.com/${trimTrailingSlashes(canonicalPath)}`
  };
}

function normaliseChannelInput(platform, rawInput) {
  switch (platform) {
    case 'twitch':
      return normaliseTwitchInput(rawInput);
    case 'tiktok':
      return normaliseTikTokInput(rawInput);
    case 'youtube':
      return normaliseYouTubeInput(rawInput);
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function checkTwitchChannel(channel) {
  try {
    const page = await fetchPage(channel.url);
    if (page.status >= 400) {
      return buildOfflineResult('twitch', channel, { error: `HTTP ${page.status}` });
    }

    const isLive = /"isLiveBroadcast"\s*:\s*true/i.test(page.html) ||
      /"isLive"\s*:\s*true/i.test(page.html) ||
      /"isLiveNow"\s*:\s*true/i.test(page.html);

    return {
      platform: 'twitch',
      isLive,
      checkedAt: new Date().toISOString(),
      liveUrl: channel.url,
      title: cleanTitle(extractMetaContent(page.html, 'property', 'og:title') || extractMetaContent(page.html, 'name', 'twitter:title')),
      pageUrl: page.finalUrl
    };
  } catch (error) {
    return buildOfflineResult('twitch', channel, { error: error.message || String(error) });
  }
}

async function checkYouTubeChannel(channel) {
  const monitorUrl = `${trimTrailingSlashes(channel.url)}/live`;

  try {
    const page = await fetchPage(monitorUrl);
    if (page.status >= 400) {
      return buildOfflineResult('youtube', channel, { error: `HTTP ${page.status}` });
    }

    const isLive = page.finalUrl.includes('/watch?') ||
      /"isLiveContent"\s*:\s*true/i.test(page.html) ||
      /"isLive"\s*:\s*true/i.test(page.html) ||
      /"isLiveNow"\s*:\s*true/i.test(page.html);

    return {
      platform: 'youtube',
      isLive,
      checkedAt: new Date().toISOString(),
      liveUrl: isLive ? page.finalUrl : monitorUrl,
      title: cleanTitle(extractMetaContent(page.html, 'property', 'og:title') || extractMetaContent(page.html, 'name', 'title')),
      pageUrl: page.finalUrl
    };
  } catch (error) {
    return buildOfflineResult('youtube', channel, { error: error.message || String(error) });
  }
}

async function checkTikTokChannel(channel) {
  const monitorUrl = `${trimTrailingSlashes(channel.url)}/live`;

  try {
    const page = await fetchPage(monitorUrl);
    if (page.status >= 400) {
      return buildOfflineResult('tiktok', channel, { error: `HTTP ${page.status}` });
    }

    const isLive = (/"liveRoom/i.test(page.html) && /"statusCode"\s*:\s*0/i.test(page.html)) ||
      /"isLive"\s*:\s*true/i.test(page.html) ||
      /"liveRoomId"\s*:/i.test(page.html);

    return {
      platform: 'tiktok',
      isLive,
      checkedAt: new Date().toISOString(),
      liveUrl: isLive ? page.finalUrl : monitorUrl,
      title: cleanTitle(extractMetaContent(page.html, 'property', 'og:title') || extractMetaContent(page.html, 'name', 'twitter:title')),
      pageUrl: page.finalUrl
    };
  } catch (error) {
    return buildOfflineResult('tiktok', channel, { error: error.message || String(error) });
  }
}

async function checkLiveChannel(channel) {
  switch (channel.platform) {
    case 'twitch':
      return checkTwitchChannel(channel);
    case 'tiktok':
      return checkTikTokChannel(channel);
    case 'youtube':
      return checkYouTubeChannel(channel);
    default:
      return buildOfflineResult(channel.platform || 'unknown', channel, { error: 'Unsupported platform' });
  }
}

module.exports = {
  checkLiveChannel,
  normaliseChannelInput,
  PLATFORM_LABELS,
  PLATFORMS
};

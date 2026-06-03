// API client for subscription management
// Handles all communication with the backend subscription API

/**
 * Get the stored API key
 */
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey'], (result) => {
      resolve(result.apiKey || null);
    });
  });
}

/**
 * Make an authenticated API call
 */
async function apiFetch(endpoint, options = {}) {
  const { skipAuth = false, ...fetchOptions } = options;
  const baseUrl = window.NEURALWAYS_CONFIG?.API_BASE_URL || "";
  const url = baseUrl + endpoint;

  const headers = {
    'Content-Type': 'application/json',
    ...fetchOptions.headers
  };

  if (!skipAuth) {
    const apiKey = await getApiKey();
    if (!apiKey) {
      throw new Error('API key not found. Please authenticate first.');
    }
    headers['X-API-Key'] = apiKey;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers
  });

  if (response.status === 401) {
    throw new Error('API key invalid. Please re-authenticate.');
  } else if (response.status === 403) {
    throw new Error('This feature requires Premium subscription.');
  } else if (response.status === 429) {
    throw new Error('Daily limit reached. Try again tomorrow.');
  } else if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.message || `API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Check subscription status
 * GET /subscription/status
 * Returns: { tier, daily_usage: { posts_scraped, emails_sent }, daily_limits: { posts, emails }, can_download_csv, can_send_emails }
 */
async function checkSubscriptionStatus() {
  try {
    const data = await apiFetch('/subscription/status');
    return {
      success: true,
      ...data
    };
  } catch (error) {
    console.error('Failed to fetch subscription status:', error);
    return {
      success: false,
      error: error.message,
      tier: 'free',
      daily_usage: { posts_scraped: 0, emails_sent: 0 },
      daily_limits: { posts: 50, emails: 5 },
      can_download_csv: false,
      can_send_emails: false
    };
  }
}

/**
 * Track posts scraped
 * POST /subscription/track-posts?count=N
 */
async function trackPostsScraped(count) {
  try {
    const data = await apiFetch(`/subscription/track-posts?count=${encodeURIComponent(count)}`, {
      method: 'POST'
    });
    return { success: true, ...data };
  } catch (error) {
    console.error('Failed to track posts:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Track emails sent
 * POST /subscription/track-email?email_count=N
 */
async function trackEmailSent(count) {
  try {
    const data = await apiFetch(`/subscription/track-email?email_count=${encodeURIComponent(count)}`, {
      method: 'POST'
    });
    return { success: true, ...data };
  } catch (error) {
    console.error('Failed to track emails:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Track CSV download
 * POST /subscription/track-download
 */
async function trackDownload() {
  try {
    const data = await apiFetch('/subscription/track-download', {
      method: 'POST'
    });
    return { success: true, ...data };
  } catch (error) {
    console.error('Failed to track download:', error);
    return { success: false, error: error.message };
  }
}

// Make functions available globally
window.api = {
  getApiKey,
  checkSubscriptionStatus,
  trackPostsScraped,
  trackEmailSent,
  trackDownload
};
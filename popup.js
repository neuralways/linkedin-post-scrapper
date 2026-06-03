const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send"
].join(" ");

const defaults = {
  apiBaseUrl: window.NEURALWAYS_CONFIG?.API_BASE_URL || "",
  googleClientId: window.NEURALWAYS_CONFIG?.GOOGLE_CLIENT_ID || "",
  accessToken: "",
  tokenExpiresAt: 0,
  profile: null,
  postsCollected: 0,
  speed: 5,
  requireEmail: false,
  includeResume: true,
  latestAnalysis: null,
  drafts: [],
  apiKey: ""
};

// Utility functions for loading states
function setButtonLoading(btn, isLoading) {
  if (isLoading) {
    btn.classList.add("loading");
    btn.disabled = true;
  } else {
    btn.classList.remove("loading");
    btn.disabled = false;
  }
}

function setStatus(ui, message, isLoading = false) {
  ui.statusMessage.textContent = message;
  if (isLoading) {
    ui.statusMessage.classList.add("loading");
  } else {
    ui.statusMessage.classList.remove("loading");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const ui = bindUi();
  let state = { ...defaults };
  let isScraping = false;
  let subscriptionStatus = null;

  chrome.storage.local.get(defaults, (stored) => {
    state = { ...defaults, ...stored };
    hydrate(ui, state);
    refreshSession(ui, state);
    loadSubscriptionStatus(ui);
  });

  ui.loginBtn.addEventListener("click", login);
  ui.logoutBtn.addEventListener("click", logout);
  ui.saveProfileBtn.addEventListener("click", saveProfile);
  ui.uploadResumeBtn.addEventListener("click", uploadResume);
  ui.speedRange.addEventListener("input", updateScrapeConfig);
  ui.requireEmail.addEventListener("change", updateScrapeConfig);
  ui.toggleScraping.addEventListener("click", toggleScraping);
  ui.downloadBtn.addEventListener("click", async () => {
    if (!subscriptionStatus || !subscriptionStatus.can_download_csv) {
      // Show upgrade modal
      if (confirm('Download CSV is a Premium feature. Upgrade now?')) {
        const stripeUrl = window.NEURALWAYS_CONFIG?.STRIPE_PAYMENT_URL || 'https://your-stripe-payment-page.com';
        chrome.tabs.create({ url: stripeUrl });
      }
      return;
    }
    // Download and track
    const result = await sendToContent({ action: "downloadCSV" });
    if (result?.ok) {
      window.api.trackDownload().catch(console.error);
    }
  });
  ui.resetBtn.addEventListener("click", resetData);
  ui.analyzeBtn.addEventListener("click", analyzePosts);
  ui.draftBtn.addEventListener("click", async () => {
    if (!subscriptionStatus || !subscriptionStatus.can_send_emails) {
      if (confirm('Email features are Premium. Upgrade now?')) {
        const stripeUrl = window.NEURALWAYS_CONFIG?.STRIPE_PAYMENT_URL || 'https://your-stripe-payment-page.com';
        chrome.tabs.create({ url: stripeUrl });
      }
      return;
    }
    generateDrafts();
  });

  ui.sendBtn.addEventListener("click", async () => {
    if (!subscriptionStatus || !subscriptionStatus.can_send_emails) {
      if (confirm('Email features are Premium. Upgrade now?')) {
        const stripeUrl = window.NEURALWAYS_CONFIG?.STRIPE_PAYMENT_URL || 'https://your-stripe-payment-page.com';
        chrome.tabs.create({ url: stripeUrl });
      }
      return;
    }
    sendMails();
  });
  ui.includeResume.addEventListener("change", () => {
    state.includeResume = ui.includeResume.checked;
    chrome.storage.local.set({ includeResume: state.includeResume });
  });

  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "updateCount") {
      const previousCount = state.postsCollected;
      state.postsCollected = request.count;
      chrome.storage.local.set({ postsCollected: request.count });
      updatePostCount(ui, request.count);
      
      // Track posts scraped if we have a subscription and this is a new post
      if (subscriptionStatus && request.count > previousCount) {
        const newPosts = request.count - previousCount;
        // Track in background
        window.api.trackPostsScraped(newPosts).catch(console.error);
        
        // Check if we've hit the limit
        const posts = subscriptionStatus.daily_usage.posts_scraped + newPosts;
        const postsLimit = subscriptionStatus.daily_limits.posts;
        if (subscriptionStatus.tier === 'free' && posts >= postsLimit) {
          // Stop scraping automatically
          isScraping = false;
          ui.toggleScraping.textContent = "Start auto scan";
          ui.toggleScraping.classList.remove("active");
          setStatus(ui, 'Daily post limit reached. Scraping stopped.');
          // Update subscription status to reflect new usage
          loadSubscriptionStatus();
        }
      }
    }
  });

  async function login() {
    try {
      setButtonLoading(ui.loginBtn, true);
      setStatus(ui, "Opening Google login...", true);
      state.apiBaseUrl = normalizeBaseUrl(window.NEURALWAYS_CONFIG?.API_BASE_URL || state.apiBaseUrl);
      state.googleClientId = (window.NEURALWAYS_CONFIG?.GOOGLE_CLIENT_ID || state.googleClientId).trim();
      if (!state.googleClientId) throw new Error("Add your Google OAuth Client ID first.");

      const redirectUri = chrome.identity.getRedirectURL("oauth2");
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      const oauthState = crypto.getRandomValues(new Uint32Array(4)).join("-");
      authUrl.searchParams.set("client_id", state.googleClientId);
      authUrl.searchParams.set("redirect_uri", redirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("scope", GOOGLE_SCOPES);
      authUrl.searchParams.set("prompt", "consent");
      authUrl.searchParams.set("state", oauthState);

      const responseUrl = await chrome.identity.launchWebAuthFlow({
        url: authUrl.toString(),
        interactive: true
      });
      const callback = new URL(responseUrl);
      const code = callback.searchParams.get("code");
      const returnedState = callback.searchParams.get("state");
      if (!code || returnedState !== oauthState) throw new Error("Google login did not complete securely.");

      setStatus(ui, "Exchanging Google code...", true);
      const form = new FormData();
      form.append("code", code);
      form.append("state", returnedState);
      const tokenData = await apiFetch("/auth/google/frontend-token", {
        method: "POST",
        body: form,
        skipAuth: true
      });

      state.accessToken = tokenData.access_token;
      state.tokenExpiresAt = Date.now() + ((tokenData.expires_in || 3600) * 1000);
      await chrome.storage.local.set({
        accessToken: state.accessToken,
        tokenExpiresAt: state.tokenExpiresAt
      });
      await refreshSession(ui, state);
      // Store apiKey from profile if available
      if (state.profile?.apiKey) {
        state.apiKey = state.profile.apiKey;
        await chrome.storage.sync.set({ apiKey: state.profile.apiKey });
      }
      setStatus(ui, "✓ Signed in. NeuGPT is ready for LinkedIn analysis.");
    } catch (error) {
      setStatus(ui, `✗ ${error.message}`);
    } finally {
      setButtonLoading(ui.loginBtn, false);
    }
  }

  async function logout() {
    state.accessToken = "";
    state.tokenExpiresAt = 0;
    state.profile = null;
    await chrome.storage.local.set({ accessToken: "", tokenExpiresAt: 0, profile: null, drafts: [] });
    renderDrafts(ui, []);
    renderAuth(ui, state);
    setStatus(ui, "Signed out.");
  }

  async function refreshSession() {
    renderAuth(ui, state);
    if (!isAuthed(state)) return;
    try {
      setStatus(ui, "Connecting to NeuGPT...", true);
      const profile = await apiFetch("/auth/profile");
      state.profile = profile;
      await chrome.storage.local.set({ profile });
      renderProfile(ui, profile);
      await loadDrafts();
      setStatus(ui, "✓ Connected to NeuGPT.");
    } catch (error) {
      setStatus(ui, `✗ Session check failed: ${error.message}`);
    }
  }

  async function loadSubscriptionStatus() {
    try {
      const result = await window.api.checkSubscriptionStatus();
      if (result.success) {
        subscriptionStatus = result.data || result;
        updateSubscriptionUI();
      } else {
        console.warn('Failed to load subscription status:', result.error);
        subscriptionStatus = {
          tier: 'free',
          daily_usage: { posts_scraped: 0, emails_sent: 0 },
          daily_limits: { posts: 50, emails: 5 },
          can_download_csv: false,
          can_send_emails: false
        };
        updateSubscriptionUI();
      }
    } catch (error) {
      console.error('Error loading subscription status:', error);
    }
  }

  async function saveProfile() {
    try {
      requireAuth();
      setButtonLoading(ui.saveProfileBtn, true);
      setStatus(ui, "Saving profile...", true);
      const payload = {
        name: ui.profileName.value.trim() || null,
        email: ui.profileEmail.value.trim() || null,
        skills: splitList(ui.profileSkills.value),
        interested_roles: splitList(ui.profileRoles.value),
        preferred_locations: splitList(ui.profileLocations.value),
        years_of_experience: ui.profileExperience.value ? Number(ui.profileExperience.value) : null,
        bio: ui.profileBio.value.trim() || null
      };
      const profile = await apiFetch("/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      state.profile = profile;
      await chrome.storage.local.set({ profile });
      renderProfile(ui, profile);
      setStatus(ui, "✓ Profile saved.");
    } catch (error) {
      setStatus(ui, `✗ ${error.message}`);
    } finally {
      setButtonLoading(ui.saveProfileBtn, false);
    }
  }

  async function uploadResume() {
    try {
      requireAuth();
      setButtonLoading(ui.uploadResumeBtn, true);
      setStatus(ui, "Uploading resume...", true);
      const file = ui.resumeFile.files[0];
      if (!file) throw new Error("Choose a resume file first.");
      const form = new FormData();
      form.append("file", file);
      const result = await apiFetch("/auth/profile/resume", { method: "POST", body: form });
      ui.resumeStatus.textContent = `${result.file_name} uploaded`;
      setStatus(ui, "✓ Resume uploaded.");
    } catch (error) {
      setStatus(ui, `✗ ${error.message}`);
    } finally {
      setButtonLoading(ui.uploadResumeBtn, false);
    }
  }

  function updateScrapeConfig() {
    state.speed = ui.speedRange.value;
    state.requireEmail = ui.requireEmail.checked;
    chrome.storage.local.set({ speed: state.speed, requireEmail: state.requireEmail });
    sendToContent({ action: "updateConfig", speed: state.speed, requireEmail: state.requireEmail });
  }

  function toggleScraping() {
    if (!isScraping && subscriptionStatus) {
      const posts = subscriptionStatus.daily_usage.posts_scraped;
      const postsLimit = subscriptionStatus.daily_limits.posts;
      if (subscriptionStatus.tier === 'free' && posts >= postsLimit) {
        setStatus(ui, '✗ Daily post limit reached for Free tier. Upgrade to Premium for more posts.');
        return;
      }
    }
    isScraping = !isScraping;
    ui.toggleScraping.textContent = isScraping ? "Stop auto scan" : "Start auto scan";
    ui.toggleScraping.classList.toggle("active", isScraping);
    chrome.storage.local.set({ isScraping });
    sendToContent({
      action: isScraping ? "startScraping" : "stopScraping",
      speed: ui.speedRange.value,
      requireEmail: ui.requireEmail.checked
    });
    setStatus(ui, isScraping ? "Scanning visible LinkedIn posts..." : "Scan paused.");
  }

  async function analyzePosts() {
    try {
      requireAuth();
      setButtonLoading(ui.analyzeBtn, true);
      setStatus(ui, "Sending CSV to NeuGPT for analysis...", true);
      const data = await sendToContent({ action: "getCSV" });
      if (!data?.csv) throw new Error("No LinkedIn posts collected yet.");
      const form = new FormData();
      form.append("file", new Blob([data.csv], { type: "text/csv" }), `linkedin_posts_${new Date().toISOString().slice(0, 10)}.csv`);
      const result = await apiFetch("/linkedin/analyze-posts", { method: "POST", body: form });
      state.latestAnalysis = result;
      await chrome.storage.local.set({ latestAnalysis: result });
      ui.draftBtn.disabled = false;
      setStatus(ui, "✓ Analysis saved. Drafting is available.");
    } catch (error) {
      setStatus(ui, `✗ ${error.message}`);
    } finally {
      setButtonLoading(ui.analyzeBtn, false);
    }
  }

  async function generateDrafts() {
    try {
      requireAuth();
      setButtonLoading(ui.draftBtn, true);
      setStatus(ui, "Generating draft emails from analysis...", true);
      await apiFetch("/linkedin/draft/mails", { method: "POST" });
      await loadDrafts();
      setStatus(ui, "✓ Drafts ready for review.");
    } catch (error) {
      setStatus(ui, `✗ ${error.message}`);
    } finally {
      setButtonLoading(ui.draftBtn, false);
    }
  }

  async function loadDrafts() {
    if (!isAuthed(state)) return;
    try {
      const result = await apiFetch("/linkedin/draft/drafts?sent=false");
      state.drafts = result.drafts || [];
      await chrome.storage.local.set({ drafts: state.drafts });
      renderDrafts(ui, state.drafts);
    } catch (error) {
      console.error("Failed to load drafts:", error);
    }
  }

  async function sendMails() {
    try {
      requireAuth();
      if (!state.drafts.length) throw new Error("No pending drafts to send.");
      
      const emailsSent = state.drafts.length;
      
      setButtonLoading(ui.sendBtn, true);
      setStatus(ui, "Sending pending emails...", true);
      ui.sendProgress.style.display = "block";
      
      // Simulate progress animation
      let progress = 0;
      const progressInterval = setInterval(() => {
        if (progress < 90) {
          progress += Math.random() * 30;
          ui.sendProgressBar.style.width = Math.min(progress, 90) + "%";
        }
      }, 500);
      
      const query = ui.includeResume.checked ? "?include_resume=true" : "?include_resume=false";
      await apiFetch(`/linkedin/draft/send${query}`, { method: "POST" });
      
      clearInterval(progressInterval);
      ui.sendProgressBar.style.width = "100%";
      ui.sendProgressText.textContent = "Mails sent successfully!";
      
      // Track emails sent
      window.api.trackEmailSent(emailsSent).catch(console.error);
      
      await loadDrafts();
      
      setTimeout(() => {
        ui.sendProgress.style.display = "none";
        ui.sendProgressBar.style.width = "0%";
        ui.sendProgressText.textContent = "Sending mails...";
        setStatus(ui, "✓ Pending emails sent successfully.");
      }, 1000);
    } catch (error) {
      ui.sendProgress.style.display = "none";
      ui.sendProgressBar.style.width = "0%";
      setStatus(ui, `✗ ${error.message}`);
    } finally {
      setButtonLoading(ui.sendBtn, false);
    }
  }

  function resetData() {
    state.postsCollected = 0;
    chrome.storage.local.set({ postsCollected: 0, latestAnalysis: null, drafts: [] });
    updatePostCount(ui, 0);
    renderDrafts(ui, []);
    sendToContent({ action: "resetData" });
    setStatus(ui, "Collected LinkedIn posts reset.");
  }

  async function apiFetch(path, options = {}) {
    const baseUrl = normalizeBaseUrl(window.NEURALWAYS_CONFIG?.API_BASE_URL || state.apiBaseUrl);
    const headers = new Headers(options.headers || {});
    if (!options.skipAuth) {
      requireAuth();
      headers.set("Authorization", `Bearer ${state.accessToken}`);
    }
    const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof body === "object" ? body.detail || body.message : body;
      throw new Error(detail || `NeuGPT returned ${response.status}`);
    }
    return body;
  }

  function requireAuth() {
    if (!isAuthed(state)) throw new Error("Login with Google first.");
  }

  function sendToContent(message) {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (!tabId) return reject(new Error("No active LinkedIn tab found."));
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) return reject(new Error("Refresh the LinkedIn tab and try again."));
          if (response?.error) return reject(new Error(response.error));
          resolve(response);
        });
      });
    });
  }
});

function bindUi() {
  return Object.fromEntries(Array.from(document.querySelectorAll("[id]")).map((el) => [el.id, el]));
}

function hydrate(ui, state) {
  ui.speedRange.value = state.speed;
  ui.requireEmail.checked = state.requireEmail;
  ui.includeResume.checked = state.includeResume !== false;
  updatePostCount(ui, state.postsCollected);
  renderProfile(ui, state.profile);
  renderDrafts(ui, state.drafts || []);
}

function renderAuth(ui, state) {
  const signedIn = isAuthed(state);
  ui.authBadge.textContent = signedIn ? (state.profile?.email || "Signed in") : "Signed out";
  ui.authBadge.classList.toggle("signed-in", signedIn);
  ui.loginBtn.disabled = signedIn;
  ui.logoutBtn.disabled = !signedIn;
  ui.accountLine.textContent = signedIn
    ? `${state.profile?.name || "Google account"} is connected.`
    : "Sign in to analyze posts and send Gmail outreach.";
  const count = Number.parseInt(ui.postCount.textContent, 10) || 0;
  ui.analyzeBtn.disabled = count === 0 || !signedIn;
  // Update subscription UI
  updateSubscriptionUI();
}

function renderProfile(ui, profile) {
  if (!profile) return;
  ui.profileName.value = profile.name || "";
  ui.profileEmail.value = profile.email || "";
  ui.profileSkills.value = (profile.skills || []).join(", ");
  ui.profileRoles.value = (profile.interested_roles || []).join(", ");
  ui.profileLocations.value = (profile.preferred_locations || []).join(", ");
  ui.profileExperience.value = profile.years_of_experience ?? "";
  ui.profileBio.value = profile.bio || "";
  ui.resumeStatus.textContent = profile.resume?.file_name ? `${profile.resume.file_name} uploaded` : "No resume loaded";
}

function renderDrafts(ui, drafts) {
  ui.draftCount.textContent = `${drafts.length} mails`;
  ui.sendBtn.disabled = drafts.length === 0;
  ui.draftList.innerHTML = drafts.length
    ? drafts.map((draft) => {
      const recipient = escapeHtml(draft.to_email || draft.email || draft.recipient || "Recipient unavailable");
      const subject = escapeHtml(draft.subject || "No subject");
      const body = escapeHtml(draft.body || draft.email_body || draft.message || "").slice(0, 260);
      return `<article class="draft-card"><strong>${recipient}</strong><p>${subject}</p><p>${body}</p></article>`;
    }).join("")
    : `<p class="muted">Drafted mails will appear here after NeuGPT analyzes your latest LinkedIn CSV.</p>`;
}

function updatePostCount(ui, count) {
  ui.postCount.textContent = `${count} posts`;
  ui.downloadBtn.disabled = count === 0;
  ui.resetBtn.disabled = count === 0;
  ui.analyzeBtn.disabled = count === 0 || !isAuthed({
    accessToken: ui.authBadge.classList.contains("signed-in") ? "token" : "",
    tokenExpiresAt: Date.now() + 1000
  });
}

function updatePostCount(ui, count) {
  ui.postCount.textContent = `${count} posts`;
  ui.downloadBtn.disabled = count === 0;
  ui.resetBtn.disabled = count === 0;
  ui.analyzeBtn.disabled = count === 0 || !isAuthed({
    accessToken: ui.authBadge.classList.contains("signed-in") ? "token" : "",
    tokenExpiresAt: Date.now() + 1000
  });
}

function isAuthed(state) {
  return Boolean(state.accessToken && state.tokenExpiresAt > Date.now());
}

function normalizeBaseUrl(value) {
  return (value || defaults.apiBaseUrl).trim().replace(/\/+$/, "");
}

function splitList(value) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));
}

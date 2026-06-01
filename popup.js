document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggleScraping');
  const downloadBtn = document.getElementById('downloadBtn');
  const resetBtn = document.getElementById('resetBtn');
  const speedRange = document.getElementById('speedRange');
  const speedValue = document.getElementById('speedValue');
  const requireEmailCheckbox = document.getElementById('requireEmail');
  const postCount = document.getElementById('postCount');
  const statusMessage = document.getElementById('statusMessage');

  let isScraping = false;

  // Load saved state
  chrome.storage.local.get(['isScraping', 'postsCollected', 'speed', 'requireEmail'], (result) => {
    if (result.isScraping) {
      isScraping = true;
      updateToggleButton();
    }
    if (result.postsCollected) {
      postCount.textContent = result.postsCollected;
      if (result.postsCollected > 0) {
        downloadBtn.disabled = false;
        resetBtn.disabled = false;
      }
    }
    if (result.speed) {
      speedRange.value = result.speed;
      speedValue.textContent = result.speed;
    }
    if (result.requireEmail) {
      requireEmailCheckbox.checked = result.requireEmail;
    }
  });

  speedRange.addEventListener('input', () => {
    speedValue.textContent = speedRange.value;
    chrome.storage.local.set({ speed: speedRange.value });
    // Send speed update to content script
    sendMessageToContentScript({ action: 'updateConfig', speed: speedRange.value });
  });

  requireEmailCheckbox.addEventListener('change', () => {
    chrome.storage.local.set({ requireEmail: requireEmailCheckbox.checked });
    sendMessageToContentScript({ action: 'updateConfig', requireEmail: requireEmailCheckbox.checked });
  });

  toggleBtn.addEventListener('click', () => {
    isScraping = !isScraping;
    updateToggleButton();

    const action = isScraping ? 'startScraping' : 'stopScraping';
    chrome.storage.local.set({ isScraping: isScraping });

    sendMessageToContentScript({
      action: action,
      speed: speedRange.value,
      requireEmail: requireEmailCheckbox.checked
    });
  });

  downloadBtn.addEventListener('click', () => {
    sendMessageToContentScript({ action: 'downloadCSV' });
  });

  resetBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete all collected posts?')) {
      chrome.storage.local.set({ postsCollected: 0 });
      postCount.textContent = '0';
      downloadBtn.disabled = true;
      resetBtn.disabled = true;
      sendMessageToContentScript({ action: 'resetData' });
    }
  });

  // Listen for messages from content script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateCount') {
      postCount.textContent = request.count;
      if (request.count > 0) {
        downloadBtn.disabled = false;
        resetBtn.disabled = false;
      }
      chrome.storage.local.set({ postsCollected: request.count });
    }
  });

  function updateToggleButton() {
    if (isScraping) {
      toggleBtn.textContent = 'Stop Scraping';
      toggleBtn.classList.add('active');
      statusMessage.textContent = 'Scraping is active...';
    } else {
      toggleBtn.textContent = 'Start Scraping';
      toggleBtn.classList.remove('active');
      statusMessage.textContent = 'Ready to scrape';
    }
  }

  function sendMessageToContentScript(message) {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch((err) => {
          console.log("Could not send message, content script might not be ready yet", err);
          statusMessage.textContent = "Error: Refresh LinkedIn page";
        });
      }
    });
  }
});

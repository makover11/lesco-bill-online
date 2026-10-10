/**
 * background.js
 * Service Worker for Check LESCO Online Bill Extension (Manifest V3).
 * Provides context menu integration, shortcut handling, and tab orchestration.
 */

// Install / startup listener
chrome.runtime.onInstalled.addListener(function () {
  setupContextMenu();
});

chrome.runtime.onStartup.addListener(function () {
  setupContextMenu();
});

/**
 * Creates context menu for looking up selected text on any page.
 */
function setupContextMenu() {
  if (!chrome.contextMenus) return;

  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: 'lesco-check-selected-bill',
      title: 'Check LESCO Bill for "%s"',
      contexts: ['selection']
    });
  });
}

// Handle context menu clicks
if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId === 'lesco-check-selected-bill' && info.selectionText) {
      var raw = info.selectionText.trim();
      var digits = raw.replace(/\D/g, '');

      var type = 'refno';
      if (digits.length === 10) {
        type = 'appno';
      } else if (digits.length === 14) {
        type = 'refno';
      } else if (digits.length > 10 && digits.length <= 14) {
        type = 'refno';
      } else if (digits.length > 0 && digits.length <= 10) {
        type = 'appno';
      }

      // Store query for popup/fulltab to consume
      chrome.storage.local.set({
        pendingLookup: {
          type: type,
          number: digits,
          timestamp: Date.now()
        }
      }, function () {
        // Open full tab studio mode
        chrome.tabs.create({
          url: chrome.runtime.getURL('fulltab.html')
        });
      });
    }
  });
}

// Handle messages from extension views if needed
chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (message && message.action === 'openFullTab') {
    chrome.tabs.create({
      url: chrome.runtime.getURL('fulltab.html' + (message.query ? '?' + message.query : ''))
    });
    sendResponse({ success: true });
    return true;
  }
});

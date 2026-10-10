/**
 * lesco-bill-core.js
 * Shared Core Engine for Check LESCO Online Bill Extension.
 * Handles validation, formatting, proxy API communication, HTML sanitization,
 * metadata parsing, and chrome.storage.local persistence.
 * 
 * Works identically across popup.js, fulltab.js, and background.js.
 * Zero external dependencies. Zero CSP violations.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.LescoBillCore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PROXY_BASE_URL = 'https://lesco-proxy.realbilalmd.workers.dev';
  var STORAGE_KEYS = {
    ACCOUNTS: 'lesco_saved_accounts',
    HISTORY: 'lesco_search_history',
    SETTINGS: 'lesco_user_settings',
    BILL_CACHE: 'lesco_bill_cache_v1'
  };

  /**
   * Cleans a string to extract digits only.
   * @param {string} val 
   * @returns {string}
   */
  function cleanDigits(val) {
    if (!val) return '';
    return String(val).replace(/\D/g, '');
  }

  /**
   * Formats a 14-digit Reference Number into standard XX XXXXX XXXXXXX format.
   * @param {string} digits 
   * @returns {string}
   */
  function formatRefNo(digits) {
    var d = cleanDigits(digits).slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 7) return d.slice(0, 2) + ' ' + d.slice(2);
    return d.slice(0, 2) + ' ' + d.slice(2, 7) + ' ' + d.slice(7, 14);
  }

  /**
   * Validates whether input matches required digit length for refno (14) or appno (10).
   * @param {'refno'|'appno'} type 
   * @param {string} val 
   * @returns {{ valid: boolean, digits: string, required: number, error?: string }}
   */
  function validateInput(type, val) {
    var digits = cleanDigits(val);
    var required = type === 'refno' ? 14 : 10;
    var label = type === 'refno' ? 'Reference Number' : 'Customer ID';

    if (digits.length === 0) {
      return {
        valid: false,
        digits: '',
        required: required,
        error: 'Please enter your ' + label + '.'
      };
    }

    if (digits.length !== required) {
      return {
        valid: false,
        digits: digits,
        required: required,
        error: 'Must be exactly ' + required + ' digits (you entered ' + digits.length + ').'
      };
    }

    return {
      valid: true,
      digits: digits,
      required: required
    };
  }

  /**
   * Sanitizes bill HTML from pitc server:
   * 1. Strips all <script>...</script> tags to satisfy extension CSP.
   * 2. Strips inline event handlers (onclick, onload, etc.).
   * 3. Injects base href and overrides CSS to ensure loader is hidden and bill is visible.
   * @param {string} rawHtml 
   * @returns {string} Safe HTML string
   */
  function sanitizeBillHtml(rawHtml) {
    if (!rawHtml) return '';

    // Strip script tags completely
    var cleaned = rawHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Strip inline event attributes like onclick, onload, onmouseover
    cleaned = cleaned.replace(/\son\w+\s*=\s*(["']).*?\1/gi, '');
    cleaned = cleaned.replace(/\son\w+\s*=\s*[^>\s]+/gi, '');

    // Injected style to guarantee the duplicate bill renders immediately without pitc JS loader
    var customCss = [
      '<style id="lesco-ext-override">',
      '  /* Hide remote loader container */',
      '  #loader-container, .bill-loader, #loading-bar { display: none !important; visibility: hidden !important; height: 0 !important; }',
      '  /* Ensure bill shell is visible */',
      '  .gbn-app-shell, .tab-content, .tab-content.active { display: block !important; visibility: visible !important; opacity: 1 !important; }',
      '  /* Body styling */',
      '  body { margin: 8px auto !important; padding: 0 4px !important; background: #ffffff !important; color: #0f172a !important; font-family: system-ui, -apple-system, sans-serif !important; }',
      '  table { max-width: 100% !important; border-collapse: collapse !important; }',
      '  /* Clean print view */',
      '  @media print {',
      '    .tabs, .tabs__list, .noprint, #loader-container, #lesco-ext-override { display: none !important; }',
      '    body { margin: 0 !important; padding: 0 !important; }',
      '    @page { margin: 10mm; }',
      '  }',
      '</style>'
    ].join('\n');

    // Ensure <base href="https://bill.pitc.com.pk/"> exists so all stylesheets/images resolve
    if (!/<base\b/i.test(cleaned)) {
      if (/<head\b[^>]*>/i.test(cleaned)) {
        cleaned = cleaned.replace(/<head\b[^>]*>/i, function (match) {
          return match + '\n<base href="https://bill.pitc.com.pk/">';
        });
      } else {
        cleaned = '<base href="https://bill.pitc.com.pk/">\n' + cleaned;
      }
    }

    // Insert custom style into head or at top
    if (/<\/head>/i.test(cleaned)) {
      cleaned = cleaned.replace(/<\/head>/i, customCss + '\n</head>');
    } else {
      cleaned = customCss + '\n' + cleaned;
    }

    return cleaned;
  }

  /**
   * Safely parses key fields from the bill HTML (Consumer Name, Due Date, Amounts, Units, etc.).
   * @param {string} html 
   * @returns {object} Extracted metadata summary
   */
  function parseBillSummary(html) {
    var summary = {
      isFound: true,
      consumerName: '',
      refNo: '',
      custId: '',
      billingMonth: '',
      dueDate: '',
      amountWithinDue: '',
      amountAfterDue: '',
      units: '',
      meterNo: '',
      issueDate: '',
      tariff: ''
    };

    if (!html) {
      summary.isFound = false;
      return summary;
    }

    // Check for "bill not found" markers
    if (/bill-not-found|Bill\s*Not\s*Found|No\s*Bill\s*Found|Record\s*Not\s*Found/i.test(html)) {
      summary.isFound = false;
      return summary;
    }

    try {
      // Helper to match text patterns with regex across the HTML
      function matchPattern(regex) {
        var m = html.match(regex);
        return m && m[1] ? m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim() : '';
      }

      // 1. Due Date
      var dueDateMatch = matchPattern(/DUE\s*DATE[^\w\d<]*<\/td>\s*<td[^>]*>([\w\d\s\-]+)<\/td>/i) ||
                         matchPattern(/DUE\s*DATE[:\s]*<\/b>\s*([0-9]{1,2}[-\/][A-Za-z]{3}[-\/][0-9]{2,4})/i) ||
                         matchPattern(/([0-9]{1,2}\s*[-\/]\s*(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s*[-\/]\s*[0-9]{2,4})/i);
      summary.dueDate = dueDateMatch;

      // 2. Billing Month
      var monthMatch = matchPattern(/BILLING\s*MONTH[^\w\d<]*<\/td>\s*<td[^>]*>([\w\d\s\-]+)<\/td>/i) ||
                       matchPattern(/((?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s\-]+[0-9]{2,4})/i);
      summary.billingMonth = monthMatch;

      // 3. Payable Within Due Date
      var amtWithinMatch = matchPattern(/PAYABLE\s*WITHIN\s*DUE\s*DATE[^\d<]*<\/td>\s*<td[^>]*>([\d,]+)<\/td>/i) ||
                           matchPattern(/PAYABLE\s*WITHIN\s*DUE\s*DATE[^\d<]*:?\s*<b[^>]*>([\d,]+)<\/b>/i) ||
                           matchPattern(/WITHIN\s*DUE\s*DATE[\s\S]{1,100}?([\d]{1,3}(?:,[\d]{3})+|[\d]{3,7})/i);
      summary.amountWithinDue = amtWithinMatch;

      // 4. Payable After Due Date
      var amtAfterMatch = matchPattern(/PAYABLE\s*AFTER\s*DUE\s*DATE[^\d<]*<\/td>\s*<td[^>]*>([\d,]+)<\/td>/i) ||
                          matchPattern(/PAYABLE\s*AFTER\s*DUE\s*DATE[^\d<]*:?\s*<b[^>]*>([\d,]+)<\/b>/i);
      summary.amountAfterDue = amtAfterMatch;

      // 5. Units Consumed
      var unitsMatch = matchPattern(/UNITS\s*CONSUMED[^\d<]*<\/td>\s*<td[^>]*>([\d,]+)<\/td>/i) ||
                       matchPattern(/TOTAL\s*UNITS[^\d<]*<\/td>\s*<td[^>]*>([\d,]+)<\/td>/i);
      summary.units = unitsMatch;

      // 6. Reference Number
      var refMatch = matchPattern(/REFERENCE\s*NO[^\d<]*<\/td>\s*<td[^>]*>([\d\s]+)<\/td>/i) ||
                     matchPattern(/([0-9]{2}\s+[0-9]{5}\s+[0-9]{7})/i);
      summary.refNo = refMatch;

      // 7. Consumer Name
      var nameMatch = matchPattern(/NAME\s*&\s*ADDRESS[^\w<]*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/i);
      if (nameMatch) {
        var cleanName = nameMatch.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '').trim();
        summary.consumerName = cleanName;
      }

    } catch (err) {
      console.warn('Metadata parsing note:', err);
    }

    return summary;
  }

  /**
   * Fetches the bill from the Cloudflare Worker proxy.
   * @param {'refno'|'appno'} type 
   * @param {string} digits 
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<{ success: boolean, html: string, rawHtml: string, summary: object, message?: string }>}
   */
  function fetchBill(type, digits, timeoutMs) {
    timeoutMs = timeoutMs || 15000;
    var clean = cleanDigits(digits);

    var validation = validateInput(type, clean);
    if (!validation.valid) {
      return Promise.reject(new Error(validation.error || 'Invalid digits'));
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return Promise.reject(new Error('You are currently offline. Please check your internet connection or view cached bills.'));
    }

    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var signal = controller ? controller.signal : null;
    var timer = null;

    if (controller) {
      timer = setTimeout(function () {
        controller.abort();
      }, timeoutMs);
    }

    var param = type === 'refno' ? 'refno' : 'appno';
    var url = PROXY_BASE_URL + '?' + param + '=' + encodeURIComponent(clean);

    return fetch(url, { signal: signal, cache: 'no-cache' })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          throw new Error('Server returned HTTP ' + res.status + ' (' + res.statusText + ')');
        }
        return res.json();
      })
      .then(function (data) {
        if (!data || typeof data !== 'object') {
          throw new Error('Invalid response structure received from proxy.');
        }

        if (!data.success) {
          return {
            success: false,
            message: data.message || 'Bill not found on LESCO server.',
            html: '',
            rawHtml: '',
            summary: { isFound: false }
          };
        }

        var rawHtml = data.html || '';
        var summary = parseBillSummary(rawHtml);

        if (!summary.isFound) {
          return {
            success: false,
            message: 'No active bill found for this ' + (type === 'refno' ? 'Reference Number' : 'Customer ID') + '. Please verify the digits on your physical bill.',
            html: sanitizeBillHtml(rawHtml),
            rawHtml: rawHtml,
            summary: summary
          };
        }

        var cleanHtml = sanitizeBillHtml(rawHtml);
        return {
          success: true,
          html: cleanHtml,
          rawHtml: rawHtml,
          summary: summary
        };
      })
      .catch(function (err) {
        if (timer) clearTimeout(timer);
        if (err.name === 'AbortError') {
          throw new Error('Connection timed out while contacting LESCO servers. Please try again.');
        }
        throw err;
      });
  }

  /* ── Storage Abstraction (chrome.storage.local with fallback) ── */

  var storage = {
    get: function (keys) {
      return new Promise(function (resolve) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, function (items) {
            resolve(items || {});
          });
        } else if (typeof localStorage !== 'undefined') {
          var res = {};
          var keyList = Array.isArray(keys) ? keys : [keys];
          keyList.forEach(function (k) {
            try {
              var val = localStorage.getItem(k);
              if (val !== null) res[k] = JSON.parse(val);
            } catch (e) {}
          });
          resolve(res);
        } else {
          resolve({});
        }
      });
    },

    set: function (items) {
      return new Promise(function (resolve) {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(items, function () {
            resolve();
          });
        } else if (typeof localStorage !== 'undefined') {
          Object.keys(items).forEach(function (k) {
            try {
              localStorage.setItem(k, JSON.stringify(items[k]));
            } catch (e) {}
          });
          resolve();
        } else {
          resolve();
        }
      });
    }
  };

  /**
   * Retrieves saved electricity meter accounts.
   * @returns {Promise<Array>}
   */
  function getSavedAccounts() {
    return storage.get(STORAGE_KEYS.ACCOUNTS).then(function (res) {
      return Array.isArray(res[STORAGE_KEYS.ACCOUNTS]) ? res[STORAGE_KEYS.ACCOUNTS] : [];
    });
  }

  /**
   * Saves or updates a meter account.
   * @param {{ id?: string, type: 'refno'|'appno', number: string, nickname: string, lastAmount?: string, lastDueDate?: string, lastMonth?: string }} account 
   * @returns {Promise<Array>} Updated accounts array
   */
  function saveAccount(account) {
    return getSavedAccounts().then(function (accounts) {
      var clean = cleanDigits(account.number);
      var id = account.id || ('acc_' + account.type + '_' + clean);
      var now = Date.now();

      var existingIdx = accounts.findIndex(function (a) { return a.id === id || (a.type === account.type && a.number === clean); });

      var entry = {
        id: id,
        type: account.type || 'refno',
        number: clean,
        formattedNumber: account.type === 'refno' ? formatRefNo(clean) : clean,
        nickname: (account.nickname || '').trim() || (account.type === 'refno' ? 'Reference #' + clean.slice(-4) : 'Customer #' + clean.slice(-4)),
        lastAmount: account.lastAmount || '',
        lastDueDate: account.lastDueDate || '',
        lastMonth: account.lastMonth || '',
        updatedAt: now
      };

      if (existingIdx >= 0) {
        accounts[existingIdx] = Object.assign({}, accounts[existingIdx], entry);
      } else {
        accounts.unshift(entry);
      }

      var toSave = {};
      toSave[STORAGE_KEYS.ACCOUNTS] = accounts;
      return storage.set(toSave).then(function () { return accounts; });
    });
  }

  /**
   * Deletes a saved meter account.
   * @param {string} id 
   * @returns {Promise<Array>} Updated accounts array
   */
  function deleteAccount(id) {
    return getSavedAccounts().then(function (accounts) {
      var filtered = accounts.filter(function (a) { return a.id !== id; });
      var toSave = {};
      toSave[STORAGE_KEYS.ACCOUNTS] = filtered;
      return storage.set(toSave).then(function () { return filtered; });
    });
  }

  /**
   * Retrieves recent search history records.
   * @returns {Promise<Array>}
   */
  function getSearchHistory() {
    return storage.get(STORAGE_KEYS.HISTORY).then(function (res) {
      return Array.isArray(res[STORAGE_KEYS.HISTORY]) ? res[STORAGE_KEYS.HISTORY] : [];
    });
  }

  /**
   * Adds an entry to search history (capped at 25 items).
   * @param {{ type: 'refno'|'appno', number: string, summary?: object }} entry 
   * @returns {Promise<Array>}
   */
  function addToHistory(entry) {
    return getSearchHistory().then(function (history) {
      var clean = cleanDigits(entry.number);
      // Remove previous duplicate
      history = history.filter(function (h) {
        return !(h.type === entry.type && h.number === clean);
      });

      var record = {
        id: 'hist_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: entry.type,
        number: clean,
        formattedNumber: entry.type === 'refno' ? formatRefNo(clean) : clean,
        summary: entry.summary || null,
        timestamp: Date.now()
      };

      history.unshift(record);
      if (history.length > 25) {
        history = history.slice(0, 25);
      }

      var toSave = {};
      toSave[STORAGE_KEYS.HISTORY] = history;
      return storage.set(toSave).then(function () { return history; });
    });
  }

  /**
   * Clears search history.
   * @returns {Promise}
   */
  function clearSearchHistory() {
    var toSave = {};
    toSave[STORAGE_KEYS.HISTORY] = [];
    return storage.set(toSave);
  }

  /**
   * Caches a fetched bill for offline retrieval.
   * @param {string} cacheKey 'refno:1234...'
   * @param {{ html: string, summary: object, type: string, number: string }} billData 
   * @returns {Promise}
   */
  function cacheBill(cacheKey, billData) {
    return storage.get(STORAGE_KEYS.BILL_CACHE).then(function (res) {
      var cache = res[STORAGE_KEYS.BILL_CACHE] || {};
      cache[cacheKey] = {
        html: billData.html,
        summary: billData.summary,
        type: billData.type,
        number: billData.number,
        cachedAt: Date.now()
      };
      // Keep at most 10 cached bills to stay within storage limits
      var keys = Object.keys(cache);
      if (keys.length > 10) {
        keys.sort(function (a, b) { return (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0); });
        while (keys.length > 10) {
          delete cache[keys.shift()];
        }
      }
      var toSave = {};
      toSave[STORAGE_KEYS.BILL_CACHE] = cache;
      return storage.set(toSave);
    });
  }

  /**
   * Retrieves a cached bill by key.
   * @param {string} cacheKey 
   * @returns {Promise<object|null>}
   */
  function getCachedBill(cacheKey) {
    return storage.get(STORAGE_KEYS.BILL_CACHE).then(function (res) {
      var cache = res[STORAGE_KEYS.BILL_CACHE] || {};
      return cache[cacheKey] || null;
    });
  }

  /**
   * User settings (last active type, etc.)
   */
  function getUserSettings() {
    return storage.get(STORAGE_KEYS.SETTINGS).then(function (res) {
      return res[STORAGE_KEYS.SETTINGS] || {
        activeType: 'refno',
        autoSaveSearches: true,
        lastQuery: ''
      };
    });
  }

  function saveUserSettings(settings) {
    return getUserSettings().then(function (curr) {
      var merged = Object.assign({}, curr, settings);
      var toSave = {};
      toSave[STORAGE_KEYS.SETTINGS] = merged;
      return storage.set(toSave).then(function () { return merged; });
    });
  }

  /**
   * Copies text to the user's clipboard.
   * @param {string} text 
   * @returns {Promise<boolean>}
   */
  function copyToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; });
    }
    return new Promise(function (resolve) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        resolve(ok);
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * Downloads an HTML string as a local file.
   * @param {string} filename 
   * @param {string} htmlContent 
   */
  function downloadHtmlFile(filename, htmlContent) {
    var blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  return {
    cleanDigits: cleanDigits,
    formatRefNo: formatRefNo,
    validateInput: validateInput,
    sanitizeBillHtml: sanitizeBillHtml,
    parseBillSummary: parseBillSummary,
    fetchBill: fetchBill,
    getSavedAccounts: getSavedAccounts,
    saveAccount: saveAccount,
    deleteAccount: deleteAccount,
    getSearchHistory: getSearchHistory,
    addToHistory: addToHistory,
    clearSearchHistory: clearSearchHistory,
    cacheBill: cacheBill,
    getCachedBill: getCachedBill,
    getUserSettings: getUserSettings,
    saveUserSettings: saveUserSettings,
    copyToClipboard: copyToClipboard,
    downloadHtmlFile: downloadHtmlFile
  };
});

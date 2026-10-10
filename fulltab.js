/**
 * fulltab.js
 * Studio Mode Controller for Check LESCO Online Bill Extension.
 * Handles the two-deck workspace, executive metrics, saved meter accounts manager,
 * search history, export/import, and high-definition bill viewer.
 */

(function () {
  'use strict';

  var Core = window.LescoBillCore;
  if (!Core) {
    console.error('LescoBillCore engine failed to load.');
    return;
  }

  // DOM Elements
  var form             = document.getElementById('studioSearchForm');
  var tabs             = document.querySelectorAll('.g-tab');
  var slider           = document.getElementById('tabSlider');
  var inputLabel       = document.getElementById('inputLabel');
  var input            = document.getElementById('studioInput');
  var valIcon          = document.getElementById('valIcon');
  var hint             = document.getElementById('inputHint');
  var btnCheckBill     = document.getElementById('btnCheckBill');
  var btnResetSearch   = document.getElementById('btnResetSearch');
  var navSavedCount    = document.getElementById('navSavedCount');
  var netStatusDot     = document.getElementById('netStatusDot');
  var netStatusText    = document.getElementById('netStatusText');
  var accountsContainer= document.getElementById('savedAccountsContainer');
  var historyContainer = document.getElementById('historyContainer');
  var btnClearHistory  = document.getElementById('btnClearHistory');
  var btnOpenAddModal  = document.getElementById('btnOpenAddAccountModal');
  var btnExport        = document.getElementById('btnExportAccounts');
  var btnImport        = document.getElementById('btnImportAccounts');
  var importFileInput  = document.getElementById('importFileInput');

  // Workspace
  var emptyState       = document.getElementById('emptyStateWorkspace');
  var billWorkspace    = document.getElementById('billWorkspace');
  var notFoundWorkspace= document.getElementById('notFoundWorkspace');
  var notFoundDesc     = document.getElementById('studioNotFoundDesc');
  var iframe           = document.getElementById('studioIframe');

  // Metrics
  var cardAmountDue    = document.getElementById('cardAmountDue');
  var cardMonth        = document.getElementById('cardMonth');
  var cardDueDate      = document.getElementById('cardDueDate');
  var cardAmountLate   = document.getElementById('cardAmountLate');
  var cardUnits        = document.getElementById('cardUnits');
  var cellConsumerName = document.getElementById('cellConsumerName');
  var cellRefNo        = document.getElementById('cellRefNo');
  var cellStatus       = document.getElementById('cellStatus');
  var tbBillTitle      = document.getElementById('tbBillTitle');

  // Toolbar
  var btnStudioSave    = document.getElementById('btnStudioSaveMeter');
  var btnStudioCopy    = document.getElementById('btnStudioCopy');
  var btnStudioDownload= document.getElementById('btnStudioDownload');
  var btnStudioPrint   = document.getElementById('btnStudioPrint');

  // Modal
  var accountModal     = document.getElementById('accountModal');
  var modalForm        = document.getElementById('modalForm');
  var modalType        = document.getElementById('modalType');
  var modalNumber      = document.getElementById('modalNumber');
  var modalNickname    = document.getElementById('modalNickname');
  var btnCloseModal    = document.getElementById('btnCloseModal');
  var btnCancelModal   = document.getElementById('btnCancelModal');

  // Toast
  var toastEl          = document.getElementById('studioToast');

  var activeType = 'refno';
  var currentBillData = null;

  /* ── Init ── */
  document.addEventListener('DOMContentLoaded', function () {
    positionSlider();
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    window.addEventListener('resize', positionSlider);

    loadSavedAccounts();
    loadSearchHistory();
    handleUrlParamsAndPending();
  });

  /* ── Network Status ── */
  function updateNetworkStatus() {
    var online = navigator.onLine;
    if (online) {
      netStatusDot.className = 'stat-dot';
      netStatusText.textContent = 'Online';
    } else {
      netStatusDot.className = 'stat-dot offline';
      netStatusText.textContent = 'Offline';
    }
  }

  /* ── Tab Slider ── */
  function positionSlider() {
    var active = document.querySelector('.g-tab.active');
    if (active && slider) {
      slider.style.width = active.offsetWidth + 'px';
      slider.style.left  = active.offsetLeft + 'px';
    }
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      if (this.classList.contains('active')) return;

      tabs.forEach(function (t) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });

      this.classList.add('active');
      this.setAttribute('aria-selected', 'true');
      activeType = this.dataset.type;

      positionSlider();
      resetForm(false);
    });
  });

  /* ── Input Masking ── */
  input.addEventListener('input', function (e) {
    var digits = Core.cleanDigits(e.target.value);
    if (activeType === 'refno') {
      e.target.value = Core.formatRefNo(digits);
    } else {
      e.target.value = digits.slice(0, 10);
    }
    validateInput(false);
  });

  input.addEventListener('blur', function () {
    validateInput(true);
  });

  function validateInput(showError) {
    var check = Core.validateInput(activeType, input.value);
    if (check.valid) {
      input.classList.remove('invalid');
      valIcon.classList.add('show');
      setHint(activeType === 'refno' ? '✓ Valid 14-digit Reference Number.' : '✓ Valid 10-digit Customer ID.', false);
      return true;
    } else {
      valIcon.classList.remove('show');
      if (showError && input.value.trim().length > 0) {
        input.classList.add('invalid');
        setHint('⚠ ' + check.error, true);
      } else {
        input.classList.remove('invalid');
        setHint(activeType === 'refno' ? 'Enter digits without spaces or dashes.' : 'Enter your 10-digit customer code.', false);
      }
      return false;
    }
  }

  function setHint(text, isErr) {
    hint.textContent = text;
    hint.className = isErr ? 'g-hint err' : 'g-hint';
  }

  /* ── Reset Form ── */
  btnResetSearch.addEventListener('click', function () {
    resetForm(true);
  });

  function resetForm(focus) {
    input.value = '';
    input.className = 'g-input';
    valIcon.classList.remove('show');

    if (activeType === 'refno') {
      inputLabel.textContent = '14-Digit Reference Number';
      input.placeholder = '00 00000 0000000';
      setHint('Enter digits without spaces or dashes.', false);
    } else {
      inputLabel.textContent = '10-Digit Customer ID';
      input.placeholder = '0000000000';
      setHint('Enter your 10-digit customer code.', false);
    }

    if (focus) input.focus();
  }

  /* ── Form Submit ── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var clean = Core.cleanDigits(input.value);

    if (!validateInput(true)) {
      input.focus();
      return;
    }

    executeBillQuery(activeType, clean);
  });

  function executeBillQuery(type, cleanNumber) {
    setLoading(true);
    setHint('Connecting to LESCO servers…', false);

    Core.fetchBill(type, cleanNumber)
      .then(function (result) {
        if (result.success) {
          currentBillData = {
            type: type,
            number: cleanNumber,
            html: result.html,
            summary: result.summary
          };

          setHint('✓ Bill retrieved successfully!', false);
          renderBillWorkspace(result);

          // Storage updates
          Core.cacheBill(type + ':' + cleanNumber, currentBillData);
          Core.addToHistory({
            type: type,
            number: cleanNumber,
            summary: result.summary
          }).then(loadSearchHistory);

          // Update saved account record if already saved
          updateSavedAccountMetadata(type, cleanNumber, result.summary);
        } else {
          showNotFoundWorkspace(result.message || 'No bill record found on LESCO servers.');
        }
      })
      .catch(function (err) {
        console.error('Studio fetch error:', err);
        // Attempt offline fallback from cache
        Core.getCachedBill(type + ':' + cleanNumber)
          .then(function (cached) {
            if (cached) {
              currentBillData = cached;
              renderBillWorkspace({ html: cached.html, summary: cached.summary });
              showToast('Offline Mode: Loaded previously cached bill', 'info');
              setHint('Loaded cached offline bill.', false);
            } else {
              showNotFoundWorkspace(err.message || 'Could not connect to LESCO billing system.');
              showToast(err.message || 'Connection error', 'error');
            }
          });
      })
      .finally(function () {
        setLoading(false);
      });
  }

  function setLoading(isLoading) {
    if (isLoading) {
      btnCheckBill.classList.add('loading');
      btnCheckBill.disabled = true;
      input.disabled = true;
    } else {
      btnCheckBill.classList.remove('loading');
      btnCheckBill.disabled = false;
      input.disabled = false;
    }
  }

  /* ── Render Workspace ── */
  function renderBillWorkspace(result) {
    var s = result.summary || {};

    cardAmountDue.textContent = s.amountWithinDue ? 'Rs. ' + s.amountWithinDue : 'N/A';
    cardMonth.textContent = s.billingMonth ? 'Month: ' + s.billingMonth : 'Current Billing Month';
    cardDueDate.textContent = s.dueDate || 'N/A';
    cardAmountLate.textContent = s.amountAfterDue ? 'Rs. ' + s.amountAfterDue : 'N/A';
    cardUnits.textContent = s.units ? s.units + ' kWh' : 'N/A';

    cellConsumerName.textContent = s.consumerName || 'Registered Consumer';
    cellRefNo.textContent = s.refNo || (currentBillData ? currentBillData.number : 'N/A');
    cellStatus.textContent = 'Active Bill';

    tbBillTitle.textContent = (s.refNo ? 'LESCO Bill: ' + s.refNo : 'LESCO Official Duplicate Bill') +
                              (s.billingMonth ? ' (' + s.billingMonth + ')' : '');

    iframe.srcdoc = result.html;

    emptyState.style.display = 'none';
    notFoundWorkspace.style.display = 'none';
    billWorkspace.style.display = 'flex';
  }

  function showNotFoundWorkspace(msg) {
    notFoundDesc.textContent = msg;
    emptyState.style.display = 'none';
    billWorkspace.style.display = 'none';
    notFoundWorkspace.style.display = 'block';
    setHint('⚠ Bill not found.', true);
  }

  /* ── Toolbar Actions ── */
  btnStudioPrint.addEventListener('click', function () {
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        window.print();
      }
    }
  });

  btnStudioDownload.addEventListener('click', function () {
    if (!currentBillData || !currentBillData.html) return;
    var filename = 'LESCO_Bill_' + currentBillData.number + '.html';
    Core.downloadHtmlFile(filename, currentBillData.html);
    showToast('✓ Downloaded ' + filename, 'success');
  });

  btnStudioCopy.addEventListener('click', function () {
    if (!currentBillData) return;
    var s = currentBillData.summary || {};
    var text = [
      '⚡ LESCO Electricity Bill Payment Details',
      'Account Type: ' + (currentBillData.type === 'refno' ? '14-Digit Reference No' : '10-Digit Customer ID'),
      'Account ID: ' + currentBillData.number,
      s.consumerName ? 'Consumer Name: ' + s.consumerName : null,
      s.billingMonth ? 'Billing Month: ' + s.billingMonth : null,
      s.dueDate ? 'Due Date: ' + s.dueDate : null,
      s.amountWithinDue ? 'Payable Within Due Date: Rs. ' + s.amountWithinDue : null,
      s.amountAfterDue ? 'Payable After Due Date: Rs. ' + s.amountAfterDue : null,
      s.units ? 'Units Consumed: ' + s.units + ' kWh' : null
    ].filter(Boolean).join('\n');

    Core.copyToClipboard(text).then(function (ok) {
      if (ok) showToast('✓ Payment summary copied to clipboard', 'success');
      else showToast('Could not copy to clipboard', 'error');
    });
  });

  btnStudioSave.addEventListener('click', function () {
    if (!currentBillData) return;
    openSaveAccountModal(currentBillData.type, currentBillData.number, currentBillData.summary);
  });

  /* ── Saved Accounts Manager ── */
  function loadSavedAccounts() {
    Core.getSavedAccounts().then(function (accounts) {
      navSavedCount.textContent = accounts.length;
      accountsContainer.innerHTML = '';

      if (accounts.length === 0) {
        var empty = document.createElement('div');
        empty.style.padding = '14px';
        empty.style.textAlign = 'center';
        empty.style.color = '#94a3b8';
        empty.style.fontSize = '0.8rem';
        empty.textContent = 'No saved meters yet. Click "+ Add Meter" or check a bill to save!';
        accountsContainer.appendChild(empty);
        return;
      }

      accounts.forEach(function (acc) {
        var card = document.createElement('div');
        card.className = 'account-card';

        var info = document.createElement('div');
        info.className = 'acc-info';

        var metaText = '';
        if (acc.lastAmount) {
          metaText = 'Rs. ' + acc.lastAmount + (acc.lastMonth ? ' (' + acc.lastMonth + ')' : '');
        }

        info.innerHTML = '<span class="acc-name">' + escapeHtml(acc.nickname) + '</span>' +
                         '<span class="acc-num">' + escapeHtml(acc.formattedNumber) + '</span>' +
                         (metaText ? '<span class="acc-meta">' + escapeHtml(metaText) + '</span>' : '');

        info.addEventListener('click', function () {
          loadAndQueryAccount(acc);
        });

        var actions = document.createElement('div');
        actions.className = 'acc-actions';

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-icon';
        delBtn.title = 'Delete saved meter';
        delBtn.innerHTML = '<svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>';
        delBtn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (confirm('Remove meter "' + acc.nickname + '" from saved accounts?')) {
            Core.deleteAccount(acc.id).then(function () {
              showToast('Account removed', 'info');
              loadSavedAccounts();
            });
          }
        });

        actions.appendChild(delBtn);
        card.appendChild(info);
        card.appendChild(actions);
        accountsContainer.appendChild(card);
      });
    });
  }

  function loadAndQueryAccount(acc) {
    if (activeType !== acc.type) {
      activeType = acc.type;
      tabs.forEach(function (t) {
        var isMatch = t.dataset.type === acc.type;
        t.classList.toggle('active', isMatch);
        t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
      positionSlider();
    }

    input.value = acc.formattedNumber || acc.number;
    validateInput(false);
    executeBillQuery(acc.type, acc.number);
  }

  function updateSavedAccountMetadata(type, number, summary) {
    if (!summary || (!summary.amountWithinDue && !summary.billingMonth)) return;
    Core.getSavedAccounts().then(function (accounts) {
      var found = accounts.find(function (a) { return a.type === type && a.number === number; });
      if (found) {
        found.lastAmount = summary.amountWithinDue || found.lastAmount;
        found.lastDueDate = summary.dueDate || found.lastDueDate;
        found.lastMonth = summary.billingMonth || found.lastMonth;
        Core.saveAccount(found).then(loadSavedAccounts);
      }
    });
  }

  /* ── Search History ── */
  function loadSearchHistory() {
    Core.getSearchHistory().then(function (history) {
      historyContainer.innerHTML = '';
      if (history.length === 0) {
        var empty = document.createElement('div');
        empty.style.padding = '12px';
        empty.style.textAlign = 'center';
        empty.style.color = '#94a3b8';
        empty.style.fontSize = '0.78rem';
        empty.textContent = 'No recent searches.';
        historyContainer.appendChild(empty);
        return;
      }

      history.forEach(function (item) {
        var el = document.createElement('div');
        el.className = 'history-item';

        var timeStr = formatTimeAgo(item.timestamp);
        el.innerHTML = '<span class="hist-id">' + escapeHtml(item.formattedNumber) + '</span>' +
                       '<span class="hist-time">' + timeStr + '</span>';

        el.addEventListener('click', function () {
          if (activeType !== item.type) {
            activeType = item.type;
            tabs.forEach(function (t) {
              var isMatch = t.dataset.type === item.type;
              t.classList.toggle('active', isMatch);
              t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
            });
            positionSlider();
          }
          input.value = item.formattedNumber || item.number;
          validateInput(false);
          executeBillQuery(item.type, item.number);
        });

        historyContainer.appendChild(el);
      });
    });
  }

  btnClearHistory.addEventListener('click', function () {
    if (confirm('Clear all search history?')) {
      Core.clearSearchHistory().then(function () {
        loadSearchHistory();
        showToast('Search history cleared', 'info');
      });
    }
  });

  /* ── Modal (Add / Edit Account) ── */
  btnOpenAddModal.addEventListener('click', function () {
    openSaveAccountModal(activeType, Core.cleanDigits(input.value), null);
  });

  function openSaveAccountModal(type, number, summary) {
    modalType.value = type || 'refno';
    modalNumber.value = number ? (type === 'refno' ? Core.formatRefNo(number) : number) : '';
    modalNickname.value = (summary && summary.consumerName) ? summary.consumerName.split(' ')[0] : '';

    accountModal.style.display = 'flex';
    modalNickname.focus();
  }

  btnCloseModal.addEventListener('click', function () { accountModal.style.display = 'none'; });
  btnCancelModal.addEventListener('click', function () { accountModal.style.display = 'none'; });

  modalForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var cleanNum = Core.cleanDigits(modalNumber.value);
    var type = modalType.value;
    var name = modalNickname.value.trim();

    var valid = Core.validateInput(type, cleanNum);
    if (!valid.valid) {
      alert(valid.error);
      return;
    }

    Core.saveAccount({
      type: type,
      number: cleanNum,
      nickname: name
    }).then(function () {
      accountModal.style.display = 'none';
      showToast('✓ Saved meter: ' + name, 'success');
      loadSavedAccounts();
    });
  });

  /* ── Backup Export / Import ── */
  btnExport.addEventListener('click', function () {
    Core.getSavedAccounts().then(function (accounts) {
      if (accounts.length === 0) {
        showToast('No saved accounts to export', 'info');
        return;
      }
      var dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(accounts, null, 2));
      var dlAnchor = document.createElement('a');
      dlAnchor.setAttribute('href', dataStr);
      dlAnchor.setAttribute('download', 'lesco_meters_backup.json');
      document.body.appendChild(dlAnchor);
      dlAnchor.click();
      dlAnchor.remove();
      showToast('✓ Exported ' + accounts.length + ' accounts', 'success');
    });
  });

  btnImport.addEventListener('click', function () {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function (evt) {
      try {
        var parsed = JSON.parse(evt.target.result);
        if (!Array.isArray(parsed)) throw new Error('File must contain an array of accounts');

        var chain = Promise.resolve();
        parsed.forEach(function (acc) {
          if (acc.number) {
            chain = chain.then(function () {
              return Core.saveAccount(acc);
            });
          }
        });

        chain.then(function () {
          showToast('✓ Successfully imported accounts', 'success');
          loadSavedAccounts();
        });
      } catch (err) {
        showToast('Invalid backup file', 'error');
      }
    };
    reader.readAsText(file);
  });

  /* ── URL Parameters & Background Pending Lookup ── */
  function handleUrlParamsAndPending() {
    var urlParams = new URLSearchParams(window.location.search);
    var typeParam = urlParams.get('type');
    var queryParam = urlParams.get('q');

    if (typeParam && queryParam) {
      applyQuery(typeParam, queryParam);
      return;
    }

    // Check background pending lookup
    chrome.storage.local.get(['pendingLookup'], function (res) {
      if (res && res.pendingLookup) {
        var p = res.pendingLookup;
        if (Date.now() - (p.timestamp || 0) < 600000) {
          applyQuery(p.type, p.number);
        }
        chrome.storage.local.remove('pendingLookup');
      }
    });
  }

  function applyQuery(type, number) {
    if (type === 'refno' || type === 'appno') {
      activeType = type;
      tabs.forEach(function (t) {
        var isMatch = t.dataset.type === type;
        t.classList.toggle('active', isMatch);
        t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
      });
      positionSlider();
    }
    input.value = activeType === 'refno' ? Core.formatRefNo(number) : number;
    validateInput(false);
    setTimeout(function () {
      executeBillQuery(activeType, Core.cleanDigits(number));
    }, 150);
  }

  /* ── Helpers ── */
  var toastTimer = null;
  function showToast(msg, type) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'studio-toast show ' + (type || '');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2800);
  }

  function formatTimeAgo(ts) {
    if (!ts) return '';
    var diff = Date.now() - ts;
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return mins + 'm ago';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    var days = Math.floor(hours / 24);
    return days + 'd ago';
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

})();

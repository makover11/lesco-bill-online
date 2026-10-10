/**
 * popup.js
 * Popup Controller for Check LESCO Online Bill Extension.
 * Handles user interactions, input masking, live validation, bill rendering,
 * and integration with LescoBillCore.
 */

(function () {
  'use strict';

  var Core = window.LescoBillCore;
  if (!Core) {
    console.error('LescoBillCore engine failed to load.');
    return;
  }

  // DOM elements
  var form             = document.getElementById('gForm');
  var tabs             = document.querySelectorAll('.g-tab');
  var slider           = document.getElementById('gSlider');
  var label            = document.getElementById('gLabel');
  var input            = document.getElementById('gInput');
  var valIcon          = document.getElementById('gValIcon');
  var hint             = document.getElementById('gHint');
  var btnCheck         = document.getElementById('gBtnCheck');
  var btnReset         = document.getElementById('gBtnReset');
  var accordion        = document.getElementById('gAccordion');
  var accHead          = document.getElementById('gAccHead');
  var accBody          = document.getElementById('gAccBody');
  var searchCard       = document.getElementById('searchCard');
  var previewCard      = document.getElementById('gPreviewCard');
  var notFoundCard     = document.getElementById('notFoundCard');
  var notFoundMsg      = document.getElementById('notFoundMsg');
  var btnDismissNf     = document.getElementById('btnDismissNotFound');
  var iframe           = document.getElementById('gIframe');
  var summaryStrip     = document.getElementById('summaryStrip');
  var sumDueDate       = document.getElementById('sumDueDate');
  var sumAmount        = document.getElementById('sumAmount');
  var sumMonth         = document.getElementById('sumMonth');
  var previewTitleText = document.getElementById('previewTitleText');
  var btnClose         = document.getElementById('btnClose');
  var btnPrint         = document.getElementById('btnPrint');
  var btnCopyDetails   = document.getElementById('btnCopyDetails');
  var btnSaveAccount   = document.getElementById('btnSaveThisAccount');
  var btnOpenStudio    = document.getElementById('btnOpenStudio');
  var btnToggleSaved   = document.getElementById('btnToggleSaved');
  var btnCloseSaved    = document.getElementById('btnCloseSaved');
  var savedDrawer      = document.getElementById('savedDrawer');
  var savedList        = document.getElementById('savedList');
  var savedBadge       = document.getElementById('savedCountBadge');
  var quickPillsBox    = document.getElementById('quickPillsContainer');
  var quickPillsRow    = document.getElementById('quickPillsRow');
  var toastEl          = document.getElementById('toastNotification');

  var activeType = 'refno';
  var lastRetrievedData = null;

  /* ── Initialization ── */
  document.addEventListener('DOMContentLoaded', function () {
    positionSlider();
    loadUserSettings();
    refreshSavedAccounts();
    checkPendingLookup();
  });

  window.addEventListener('resize', positionSlider);

  /* ── Slider Positioning ── */
  function positionSlider() {
    var active = document.querySelector('.g-tab.active');
    if (active && slider) {
      slider.style.width = active.offsetWidth + 'px';
      slider.style.left  = active.offsetLeft + 'px';
    }
  }

  /* ── Tab Switching ── */
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
      resetFormState(false);
      Core.saveUserSettings({ activeType: activeType });
      refreshSavedAccounts();
    });
  });

  /* ── Input Masking & Validation ── */
  input.addEventListener('input', function (e) {
    var digits = Core.cleanDigits(e.target.value);
    if (activeType === 'refno') {
      e.target.value = Core.formatRefNo(digits);
    } else {
      e.target.value = digits.slice(0, 10);
    }
    validateInputState(false);
  });

  input.addEventListener('blur', function () {
    validateInputState(true);
  });

  function validateInputState(showError) {
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
    if (isErr) {
      hint.classList.add('err');
    } else {
      hint.classList.remove('err');
    }
  }

  /* ── Accordion ── */
  accHead.addEventListener('click', function () {
    var isOpen = accordion.classList.toggle('open');
    accHead.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    accBody.style.maxHeight = isOpen ? (accBody.scrollHeight + 30) + 'px' : '0';
  });

  /* ── Reset Form ── */
  btnReset.addEventListener('click', function () {
    resetFormState(true);
  });

  function resetFormState(focusInput) {
    input.value = '';
    input.className = 'g-input';
    valIcon.classList.remove('show');
    previewCard.style.display = 'none';
    notFoundCard.style.display = 'none';
    summaryStrip.style.display = 'none';
    lastRetrievedData = null;

    if (activeType === 'refno') {
      label.textContent = 'Enter 14-Digit Reference Number';
      input.placeholder = '00 00000 0000000';
      setHint('Enter digits without spaces or dashes.', false);
    } else {
      label.textContent = 'Enter 10-Digit Customer ID';
      input.placeholder = '0000000000';
      setHint('Enter your 10-digit customer code.', false);
    }

    if (focusInput) input.focus();
  }

  /* ── Form Submit (Check Bill) ── */
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var clean = Core.cleanDigits(input.value);

    if (!validateInputState(true)) {
      input.focus();
      return;
    }

    // Lock UI during query
    setLoadingState(true);
    previewCard.style.display = 'none';
    notFoundCard.style.display = 'none';
    setHint('Connecting to LESCO billing system…', false);

    Core.fetchBill(activeType, clean)
      .then(function (result) {
        if (result.success) {
          lastRetrievedData = {
            type: activeType,
            number: clean,
            html: result.html,
            summary: result.summary
          };

          setHint('✓ Bill retrieved successfully!', false);
          displayBill(result);

          // Cache bill for offline & add to history
          Core.cacheBill(activeType + ':' + clean, lastRetrievedData);
          Core.addToHistory({
            type: activeType,
            number: clean,
            summary: result.summary
          });
        } else {
          // Bill not found on remote server
          showNotFound(result.message || 'No bill record found on LESCO servers.');
        }
      })
      .catch(function (err) {
        console.error('Fetch error:', err);
        // Check if cached bill exists
        Core.getCachedBill(activeType + ':' + clean)
          .then(function (cached) {
            if (cached) {
              lastRetrievedData = cached;
              displayBill({ html: cached.html, summary: cached.summary });
              showToast('Offline Mode: Loaded previously cached bill', 'info');
              setHint('Loaded cached offline bill.', false);
            } else {
              input.classList.add('invalid');
              setHint('⚠ ' + (err.message || 'Network error. Please try again.'), true);
              showToast(err.message || 'Connection failed', 'error');
            }
          });
      })
      .finally(function () {
        setLoadingState(false);
      });
  });

  function setLoadingState(isLoading) {
    if (isLoading) {
      btnCheck.classList.add('loading');
      btnCheck.disabled = true;
      btnReset.disabled = true;
      input.disabled = true;
    } else {
      btnCheck.classList.remove('loading');
      btnCheck.disabled = false;
      btnReset.disabled = false;
      input.disabled = false;
    }
  }

  /* ── Display Retrieved Bill ── */
  function displayBill(result) {
    var summary = result.summary || {};

    // Populate summary strip if details found
    if (summary.dueDate || summary.amountWithinDue || summary.billingMonth) {
      sumDueDate.textContent = summary.dueDate || 'N/A';
      sumAmount.textContent = summary.amountWithinDue ? 'Rs. ' + summary.amountWithinDue : 'N/A';
      sumMonth.textContent = summary.billingMonth || 'Current';
      summaryStrip.style.display = 'flex';
    } else {
      summaryStrip.style.display = 'none';
    }

    if (summary.refNo) {
      previewTitleText.textContent = 'Bill: ' + summary.refNo;
    } else {
      previewTitleText.textContent = 'LESCO Duplicate Bill';
    }

    // Inject sanitized HTML into sandboxed iframe using srcdoc
    iframe.srcdoc = result.html;

    previewCard.style.display = 'flex';
    notFoundCard.style.display = 'none';

    // Smooth scroll down to preview
    setTimeout(function () {
      previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  }

  /* ── Show Not Found Card ── */
  function showNotFound(msg) {
    notFoundMsg.textContent = msg;
    notFoundCard.style.display = 'flex';
    previewCard.style.display = 'none';
    setHint('⚠ Bill record not found.', true);

    setTimeout(function () {
      notFoundCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  }

  btnDismissNf.addEventListener('click', function () {
    notFoundCard.style.display = 'none';
    input.focus();
    input.select();
  });

  /* ── Action Buttons ── */
  btnClose.addEventListener('click', function () {
    previewCard.style.display = 'none';
    summaryStrip.style.display = 'none';
    iframe.srcdoc = '';
    searchCard.scrollIntoView({ behavior: 'smooth' });
  });

  btnPrint.addEventListener('click', function () {
    if (iframe && iframe.contentWindow) {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (e) {
        // Fallback: open in new tab for direct printing
        openBillInNewTab();
      }
    }
  });

  btnCopyDetails.addEventListener('click', function () {
    if (!lastRetrievedData) return;
    var s = lastRetrievedData.summary || {};
    var textLines = [
      '⚡ LESCO Electricity Bill Details',
      'Identifier: ' + (lastRetrievedData.type === 'refno' ? 'Ref No: ' : 'Customer ID: ') + lastRetrievedData.number,
      s.consumerName ? 'Consumer Name: ' + s.consumerName : null,
      s.billingMonth ? 'Billing Month: ' + s.billingMonth : null,
      s.dueDate ? 'Due Date: ' + s.dueDate : null,
      s.amountWithinDue ? 'Payable Within Due Date: Rs. ' + s.amountWithinDue : null,
      s.amountAfterDue ? 'Payable After Due Date: Rs. ' + s.amountAfterDue : null,
      s.units ? 'Units Consumed: ' + s.units : null
    ].filter(Boolean).join('\n');

    Core.copyToClipboard(textLines).then(function (ok) {
      if (ok) showToast('✓ Bill details copied to clipboard!', 'success');
      else showToast('Could not copy to clipboard', 'error');
    });
  });

  btnSaveAccount.addEventListener('click', function () {
    if (!lastRetrievedData) return;
    var defaultName = lastRetrievedData.summary && lastRetrievedData.summary.consumerName
      ? lastRetrievedData.summary.consumerName.split(' ')[0]
      : 'My Meter';

    var nickname = window.prompt('Enter a nickname for this meter account (e.g. Home, Office, Shop):', defaultName);
    if (nickname === null) return; // cancelled

    var s = lastRetrievedData.summary || {};
    Core.saveAccount({
      type: lastRetrievedData.type,
      number: lastRetrievedData.number,
      nickname: nickname.trim() || defaultName,
      lastAmount: s.amountWithinDue || '',
      lastDueDate: s.dueDate || '',
      lastMonth: s.billingMonth || ''
    }).then(function () {
      showToast('✓ Account saved: ' + (nickname || defaultName), 'success');
      refreshSavedAccounts();
    });
  });

  /* ── Studio Mode Button ── */
  btnOpenStudio.addEventListener('click', function () {
    var query = '';
    var clean = Core.cleanDigits(input.value);
    if (clean) {
      query = '?type=' + encodeURIComponent(activeType) + '&q=' + encodeURIComponent(clean);
    }
    chrome.tabs.create({
      url: chrome.runtime.getURL('fulltab.html' + query)
    });
  });

  /* ── Saved Accounts Management ── */
  btnToggleSaved.addEventListener('click', function () {
    var isHidden = savedDrawer.style.display === 'none';
    savedDrawer.style.display = isHidden ? 'block' : 'none';
    if (isHidden) refreshSavedAccounts();
  });

  btnCloseSaved.addEventListener('click', function () {
    savedDrawer.style.display = 'none';
  });

  function refreshSavedAccounts() {
    Core.getSavedAccounts().then(function (accounts) {
      // Update badge
      if (accounts.length > 0) {
        savedBadge.textContent = accounts.length;
        savedBadge.style.display = 'flex';
      } else {
        savedBadge.style.display = 'none';
      }

      // Render drawer list
      savedList.innerHTML = '';
      if (accounts.length === 0) {
        var emptyMsg = document.createElement('div');
        emptyMsg.className = 'p-saved-item';
        emptyMsg.style.justifyContent = 'center';
        emptyMsg.style.color = '#94a3b8';
        emptyMsg.textContent = 'No saved accounts yet. Check a bill to save!';
        savedList.appendChild(emptyMsg);
      } else {
        accounts.forEach(function (acc) {
          var item = document.createElement('div');
          item.className = 'p-saved-item';

          var info = document.createElement('div');
          info.className = 'p-saved-info';
          info.innerHTML = '<span class="p-saved-name">' + escapeHtml(acc.nickname) + '</span>' +
                           '<span class="p-saved-num">' + escapeHtml(acc.formattedNumber) + '</span>';

          info.addEventListener('click', function () {
            selectSavedAccount(acc);
            savedDrawer.style.display = 'none';
          });

          var delBtn = document.createElement('button');
          delBtn.className = 'p-saved-del';
          delBtn.title = 'Remove saved meter';
          delBtn.innerHTML = '&times;';
          delBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            Core.deleteAccount(acc.id).then(function () {
              showToast('Account removed', 'info');
              refreshSavedAccounts();
            });
          });

          item.appendChild(info);
          item.appendChild(delBtn);
          savedList.appendChild(item);
        });
      }

      // Render Quick Pills under input
      renderQuickPills(accounts);
    });
  }

  function renderQuickPills(accounts) {
    var matching = accounts.filter(function (a) { return a.type === activeType; });
    quickPillsRow.innerHTML = '';

    if (matching.length > 0) {
      matching.slice(0, 3).forEach(function (acc) {
        var pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'g-pill';
        pill.textContent = acc.nickname;
        pill.title = 'Load ' + acc.formattedNumber;
        pill.addEventListener('click', function () {
          selectSavedAccount(acc);
        });
        quickPillsRow.appendChild(pill);
      });
      quickPillsBox.style.display = 'flex';
    } else {
      quickPillsBox.style.display = 'none';
    }
  }

  function selectSavedAccount(acc) {
    // Switch tab if needed
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
    validateInputState(false);
    btnCheck.click();
  }

  /* ── Check Pending Context Menu Lookup ── */
  function checkPendingLookup() {
    chrome.storage.local.get(['pendingLookup'], function (res) {
      if (res && res.pendingLookup) {
        var item = res.pendingLookup;
        // Expire after 10 minutes
        if (Date.now() - (item.timestamp || 0) < 600000) {
          if (item.type && (item.type === 'refno' || item.type === 'appno')) {
            activeType = item.type;
            tabs.forEach(function (t) {
              var isMatch = t.dataset.type === item.type;
              t.classList.toggle('active', isMatch);
              t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
            });
            positionSlider();
          }
          if (item.number) {
            input.value = activeType === 'refno' ? Core.formatRefNo(item.number) : item.number;
            validateInputState(false);
            setTimeout(function () {
              btnCheck.click();
            }, 100);
          }
        }
        // Clear pending lookup
        chrome.storage.local.remove('pendingLookup');
      }
    });
  }

  function loadUserSettings() {
    Core.getUserSettings().then(function (settings) {
      if (settings && settings.activeType && settings.activeType !== activeType) {
        activeType = settings.activeType;
        tabs.forEach(function (t) {
          var isMatch = t.dataset.type === activeType;
          t.classList.toggle('active', isMatch);
          t.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });
        positionSlider();
        resetFormState(false);
      }
    });
  }

  /* ── Toast Feedback Helper ── */
  var toastTimer = null;
  function showToast(msg, type) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'g-toast show ' + (type || '');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2800);
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  function openBillInNewTab() {
    if (!lastRetrievedData || !lastRetrievedData.html) return;
    var blob = new Blob([lastRetrievedData.html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    chrome.tabs.create({ url: url });
  }

})();

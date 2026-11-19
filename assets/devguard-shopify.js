/**
 * DevGuard Shopify Theme Guard Runtime
 *
 * Client-side licensing and agency milestone protection for Shopify storefronts.
 * Integrates via Shopify Theme App Extension (App Embed block) or manual Liquid snippet.
 *
 * Features:
 * - Milestone payment status verification via DevGuard API Gateway
 * - Storefront caching in sessionStorage (TTL 60s) for Core Web Vitals preservation
 * - Configurable Lock Modes:
 *   - 'full_lock': Unclosable overlay with anti-tamper MutationObserver
 *   - 'checkout_only': Cart & checkout form disabling with informational banner
 *   - 'banner_only': Non-intrusive persistent top banner
 * - Enterprise Fail-Safe: Default 'open' ensures store operations are never interrupted
 *   by upstream API latency or network interruptions
 * - Clean Node.js / Browser dual export for automated testing & CI verification
 *
 * @package @devguard/shopify-guard
 * @version 1.0.0
 * @license MIT
 */

(function (root, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    const exportsObj = factory();
    root.DevGuardShopify = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const CACHE_TTL_MS = 60000; // 60 seconds
  const DEFAULT_API_URL = 'https://api.devguard.uk';

  let activeMutationObserver = null;
  let activeEventCleanups = [];

  /**
   * Safe document resolver
   */
  function getDoc(options) {
    if (options && options.document) return options.document;
    if (typeof document !== 'undefined') return document;
    return null;
  }

  /**
   * Safe window resolver
   */
  function getWin(options) {
    if (options && options.window) return options.window;
    if (typeof window !== 'undefined') return window;
    return null;
  }

  /**
   * Safe sessionStorage resolver
   */
  function getStorage(options) {
    if (options && options.sessionStorage) return options.sessionStorage;
    const win = getWin(options);
    if (win && win.sessionStorage) {
      try {
        // Test storage availability (can fail in private browsing)
        const testKey = '__dg_test__';
        win.sessionStorage.setItem(testKey, '1');
        win.sessionStorage.removeItem(testKey);
        return win.sessionStorage;
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  /**
   * Parses configuration from DOM root element (<div id="devguard-shopify-root">)
   */
  function parseConfigFromDom(doc) {
    const docObj = doc || getDoc();
    if (!docObj) return null;

    const rootEl = docObj.getElementById('devguard-shopify-root');
    if (!rootEl) return null;

    return {
      projectId: rootEl.getAttribute('data-project-id') || '',
      apiUrl: rootEl.getAttribute('data-api-url') || DEFAULT_API_URL,
      publicKey: rootEl.getAttribute('data-public-key') || '',
      failSafe: (rootEl.getAttribute('data-fail-safe') || 'open').toLowerCase(),
      lockMode: (rootEl.getAttribute('data-lock-mode') || 'full_lock').toLowerCase(),
    };
  }

  /**
   * Retrieves cached status if still valid
   */
  function getCachedStatus(projectId, storage) {
    if (!storage || !projectId) return null;
    try {
      const raw = storage.getItem('dg_shopify_status_' + projectId);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && typeof data === 'object' && data.timestamp) {
        if (Date.now() - data.timestamp < CACHE_TTL_MS) {
          return data;
        }
      }
    } catch (e) {
      // Ignore cache read errors
    }
    return null;
  }

  /**
   * Stores status in sessionStorage
   */
  function setCachedStatus(projectId, data, storage) {
    if (!storage || !projectId || !data) return;
    try {
      const record = Object.assign({}, data, { timestamp: Date.now() });
      storage.setItem('dg_shopify_status_' + projectId, JSON.stringify(record));
    } catch (e) {
      // Ignore cache write errors
    }
  }

  /**
   * Clears cached status
   */
  function clearCache(projectId, storage) {
    if (!storage) return;
    try {
      if (projectId) {
        storage.removeItem('dg_shopify_status_' + projectId);
      } else {
        // remove any starting with dg_shopify_status_
        const keysToRemove = [];
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key && key.startsWith('dg_shopify_status_')) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach(k => storage.removeItem(k));
      }
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Renders the unclosable responsive lock overlay with anti-tamper observer
   */
  function renderLockOverlay(message, options) {
    const doc = getDoc(options);
    if (!doc) return null;

    let overlay = doc.getElementById('devguard-lock-overlay');
    if (!overlay) {
      overlay = doc.createElement('div');
      overlay.id = 'devguard-lock-overlay';
      overlay.setAttribute('role', 'alertdialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Development Milestone Pending');

      const card = doc.createElement('div');
      card.id = 'devguard-lock-card';

      const iconDiv = doc.createElement('div');
      iconDiv.className = 'devguard-icon-container';
      iconDiv.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';

      const badge = doc.createElement('div');
      badge.className = 'devguard-pill-badge';
      badge.textContent = 'Milestone In Progress';

      const title = doc.createElement('h2');
      title.textContent = 'Development Milestone Pending';

      const desc = doc.createElement('p');
      desc.textContent = message || 'This storefront is undergoing final agency handover. Access will resume once milestone verification is finalized.';

      const footer = doc.createElement('div');
      footer.className = 'devguard-footer-brand';
      footer.textContent = 'Protected by DevGuard Licensing';

      card.appendChild(iconDiv);
      card.appendChild(badge);
      card.appendChild(title);
      card.appendChild(desc);
      card.appendChild(footer);

      overlay.appendChild(card);
      (doc.body || doc.documentElement).appendChild(overlay);
    }

    if (doc.body && doc.body.classList) {
      doc.body.classList.add('devguard-locked');
    }

    // Attach anti-tamper MutationObserver
    attachAntiTamperObserver(overlay, options);

    return overlay;
  }

  /**
   * Attaches MutationObserver to prevent malicious DOM removal of lock overlay
   */
  function attachAntiTamperObserver(targetOverlay, options) {
    const win = getWin(options);
    const doc = getDoc(options);
    const MutationObserverCtor = (options && options.MutationObserver) || (win && win.MutationObserver);

    if (!MutationObserverCtor || !doc || !targetOverlay) return;

    if (activeMutationObserver) {
      try {
        activeMutationObserver.disconnect();
      } catch (e) {}
    }

    try {
      activeMutationObserver = new MutationObserverCtor(function (mutations) {
        let needsRestore = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === 'childList') {
            for (let j = 0; j < m.removedNodes.length; j++) {
              if (m.removedNodes[j] === targetOverlay || m.removedNodes[j].id === 'devguard-lock-overlay') {
                needsRestore = true;
                break;
              }
            }
          } else if (m.type === 'attributes' && m.target === targetOverlay) {
            const style = targetOverlay.getAttribute('style') || '';
            if (style.includes('none') || style.includes('hidden') || targetOverlay.hidden) {
              targetOverlay.style.display = 'flex';
              targetOverlay.hidden = false;
            }
          }
        }

        if (needsRestore && (doc.body || doc.documentElement)) {
          (doc.body || doc.documentElement).appendChild(targetOverlay);
          if (doc.body && doc.body.classList) {
            doc.body.classList.add('devguard-locked');
          }
        }
      });

      const parent = targetOverlay.parentNode || doc.body || doc.documentElement;
      if (parent) {
        activeMutationObserver.observe(parent, { childList: true });
        activeMutationObserver.observe(targetOverlay, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
    } catch (e) {
      // In non-browser environments or when unsupported, silently continue
    }
  }

  /**
   * Renders the persistent warning top banner
   */
  function renderBanner(message, isError, options) {
    const doc = getDoc(options);
    if (!doc) return null;

    let banner = doc.getElementById('devguard-shopify-banner');
    if (!banner) {
      banner = doc.createElement('div');
      banner.id = 'devguard-shopify-banner';
      banner.setAttribute('role', 'status');
      banner.setAttribute('aria-live', 'polite');

      const icon = doc.createElement('span');
      icon.innerHTML = '&#9888;&#65039;';
      banner.appendChild(icon);

      const text = doc.createElement('span');
      text.className = 'devguard-banner-text';
      text.textContent = message || 'Notice: Storefront milestone payment is pending review.';
      banner.appendChild(text);

      const container = doc.body || doc.documentElement;
      if (container.firstChild) {
        container.insertBefore(banner, container.firstChild);
      } else {
        container.appendChild(banner);
      }
    }

    if (isError) {
      banner.classList.add('devguard-banner-error');
    } else {
      banner.classList.remove('devguard-banner-error');
    }

    return banner;
  }

  /**
   * Disables checkout and cart actions for 'checkout_only' mode
   */
  function disableCheckoutActions(message, options) {
    const doc = getDoc(options);
    if (!doc) return 0;

    let count = 0;

    // 1. Disable submit buttons inside cart forms
    const cartForms = doc.querySelectorAll('form[action*="/cart"]');
    for (let i = 0; i < cartForms.length; i++) {
      const form = cartForms[i];
      form.classList.add('devguard-cart-disabled');

      const buttons = form.querySelectorAll('button, input[type="submit"]');
      for (let j = 0; j < buttons.length; j++) {
        const btn = buttons[j];
        btn.classList.add('devguard-checkout-disabled');
        btn.setAttribute('disabled', 'disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('title', 'Checkout is paused pending milestone verification');
        count++;
      }
    }

    // 2. Disable explicit checkout links
    const checkoutLinks = doc.querySelectorAll('a[href*="/checkout"], a[href*="/cart"]');
    for (let i = 0; i < checkoutLinks.length; i++) {
      const link = checkoutLinks[i];
      link.classList.add('devguard-checkout-disabled');
      link.setAttribute('aria-disabled', 'true');
      link.setAttribute('tabindex', '-1');
      count++;
    }

    // 3. Event interception handler to prevent submissions
    function interceptCartEvents(e) {
      const target = e.target;
      if (!target) return;

      const isCartAction =
        (target.closest && (target.closest('form[action*="/cart"]') || target.closest('a[href*="/checkout"]'))) ||
        (target.form && target.form.action && target.form.action.indexOf('/cart') !== -1);

      if (isCartAction) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return false;
      }
    }

    const win = getWin(options);
    if (win && win.addEventListener) {
      win.addEventListener('submit', interceptCartEvents, true);
      win.addEventListener('click', interceptCartEvents, true);
      activeEventCleanups.push(function () {
        win.removeEventListener('submit', interceptCartEvents, true);
        win.removeEventListener('click', interceptCartEvents, true);
      });
    }

    // 4. Render top banner explaining paused checkout
    renderBanner(
      message || 'Notice: Storefront checkout is temporarily paused pending agency milestone verification.',
      false,
      options
    );

    return count;
  }

  /**
   * Cleans up all DOM interventions and listeners
   */
  function restoreStorefront(options) {
    const doc = getDoc(options);
    if (activeMutationObserver) {
      try {
        activeMutationObserver.disconnect();
      } catch (e) {}
      activeMutationObserver = null;
    }

    while (activeEventCleanups.length > 0) {
      try {
        const cleanup = activeEventCleanups.pop();
        if (typeof cleanup === 'function') cleanup();
      } catch (e) {}
    }

    if (!doc) return;

    if (doc.body && doc.body.classList) {
      doc.body.classList.remove('devguard-locked');
    }

    const overlay = doc.getElementById('devguard-lock-overlay');
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }

    const banner = doc.getElementById('devguard-shopify-banner');
    if (banner && banner.parentNode) {
      banner.parentNode.removeChild(banner);
    }

    const disabledEls = doc.querySelectorAll('.devguard-checkout-disabled, .devguard-cart-disabled');
    for (let i = 0; i < disabledEls.length; i++) {
      const el = disabledEls[i];
      el.classList.remove('devguard-checkout-disabled', 'devguard-cart-disabled');
      if (el.hasAttribute('disabled')) el.removeAttribute('disabled');
      if (el.hasAttribute('aria-disabled')) el.removeAttribute('aria-disabled');
      if (el.getAttribute('tabindex') === '-1') el.removeAttribute('tabindex');
    }
  }

  /**
   * Applies the designated lock mode to the DOM
   */
  function applyLockMode(mode, message, options) {
    const effectiveMode = (mode || 'full_lock').toLowerCase();

    if (effectiveMode === 'full_lock') {
      const overlay = renderLockOverlay(message, options);
      return {
        locked: true,
        mode: 'full_lock',
        actionApplied: 'full_lock',
        overlayCreated: Boolean(overlay),
        checkoutDisabledCount: 0,
        bannerCreated: false,
        observerAttached: Boolean(activeMutationObserver),
      };
    } else if (effectiveMode === 'checkout_only') {
      const count = disableCheckoutActions(message, options);
      return {
        locked: true,
        mode: 'checkout_only',
        actionApplied: 'checkout_only',
        overlayCreated: false,
        checkoutDisabledCount: count,
        bannerCreated: true,
        observerAttached: false,
      };
    } else if (effectiveMode === 'banner_only') {
      const banner = renderBanner(message, false, options);
      return {
        locked: true,
        mode: 'banner_only',
        actionApplied: 'banner_only',
        overlayCreated: false,
        checkoutDisabledCount: 0,
        bannerCreated: Boolean(banner),
        observerAttached: false,
      };
    }

    return {
      locked: false,
      mode: effectiveMode,
      actionApplied: 'none',
      overlayCreated: false,
      checkoutDisabledCount: 0,
      bannerCreated: false,
      observerAttached: false,
    };
  }

  /**
   * Evaluates storefront licensing status and applies intervention if needed
   *
   * @param {string|object} statusData - Status code ('active', 'locked', 'past_due', 'warning') or status object
   * @param {string} mode - 'full_lock', 'checkout_only', or 'banner_only'
   * @param {object} [options] - Optional overrides (document, window, etc.)
   * @returns {object} Evaluation summary
   */
  function evaluateStorefront(statusData, mode, options) {
    let statusCode = 'active';
    let message = '';
    let serverMode = null;

    if (typeof statusData === 'string') {
      statusCode = statusData.toLowerCase();
    } else if (statusData && typeof statusData === 'object') {
      statusCode = (statusData.status || statusData.state || 'active').toLowerCase();
      message = statusData.message || statusData.reason || '';
      serverMode = statusData.lock_mode || statusData.mode || null;
    }

    const effectiveMode = serverMode || mode || 'full_lock';

    const isLocked = statusCode === 'locked' || statusCode === 'past_due' || statusCode === 'suspended' || statusCode === 'unpaid';

    if (isLocked) {
      return applyLockMode(effectiveMode, message, options);
    } else if (statusCode === 'warning' && effectiveMode === 'banner_only') {
      const banner = renderBanner(message || 'Notice: Storefront milestone payment is pending review.', false, options);
      return {
        locked: false,
        warning: true,
        mode: effectiveMode,
        actionApplied: 'banner_only',
        overlayCreated: false,
        checkoutDisabledCount: 0,
        bannerCreated: Boolean(banner),
        observerAttached: false,
      };
    } else {
      // Normal / active status: ensure clean storefront
      restoreStorefront(options);
      return {
        locked: false,
        status: statusCode,
        mode: effectiveMode,
        actionApplied: 'none',
        overlayCreated: false,
        checkoutDisabledCount: 0,
        bannerCreated: false,
        observerAttached: false,
      };
    }
  }

  /**
   * Initializes DevGuard for Shopify
   *
   * @param {object} [customConfig] - Manual configuration overrides
   * @returns {Promise<object>}
   */
  async function initDevGuardShopify(customConfig) {
    const config = Object.assign({}, customConfig || {});

    // Parse from DOM if not provided
    if (!config.projectId) {
      const domConfig = parseConfigFromDom(config.document);
      if (domConfig) {
        Object.assign(config, domConfig);
      }
    }

    if (!config.projectId) {
      // No project ID configured; silently exit without disturbing storefront
      return { initialized: false, reason: 'missing_project_id' };
    }

    const projectId = config.projectId;
    const apiUrl = (config.apiUrl || DEFAULT_API_URL).replace(/\/+$/, '');
    const failSafe = (config.failSafe || 'open').toLowerCase();
    const lockMode = (config.lockMode || 'full_lock').toLowerCase();
    const storage = getStorage(config);

    // 1. Check cache
    const cached = getCachedStatus(projectId, storage);
    if (cached) {
      const result = evaluateStorefront(cached, lockMode, config);
      return Object.assign({ cached: true, projectId: projectId }, result);
    }

    // 2. Fetch fresh status from DevGuard API
    const fetchFn = config.fetcher || (getWin(config) && getWin(config).fetch);

    if (!fetchFn) {
      // No fetch available (e.g. archaic browser or headless without fetch)
      if (failSafe === 'closed') {
        const result = applyLockMode(lockMode, 'Verification failed: Network client unavailable.', config);
        return Object.assign({ initialized: true, failSafeTriggered: true }, result);
      }
      return { initialized: true, failSafeOpen: true, status: 'active' };
    }

    try {
      const endpoint = apiUrl + '/api/v1/projects/' + encodeURIComponent(projectId) + '/status';
      const response = await fetchFn(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-DevGuard-Client': 'Shopify-Theme-App-Extension/1.0.0',
        },
      });

      if (!response.ok) {
        throw new Error('DevGuard API responded with status ' + response.status);
      }

      const data = await response.json();

      // Cache fresh result
      setCachedStatus(projectId, data, storage);

      const result = evaluateStorefront(data, lockMode, config);
      return Object.assign({ initialized: true, cached: false, projectId: projectId }, result);
    } catch (networkError) {
      // Network failure or timeout handling
      if (failSafe === 'closed') {
        const result = applyLockMode(lockMode, 'Storefront access verification unavailable.', config);
        return Object.assign({ initialized: true, failSafeTriggered: true, error: networkError.message }, result);
      }

      // Fail-Safe OPEN: Silently pass through
      return {
        initialized: true,
        failSafeOpen: true,
        locked: false,
        actionApplied: 'none',
        error: networkError.message,
      };
    }
  }

  // Auto-boot in browser environment
  const win = getWin();
  const doc = getDoc();
  if (win && doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', function () {
        initDevGuardShopify();
      });
    } else {
      initDevGuardShopify();
    }
  }

  return {
    initDevGuardShopify: initDevGuardShopify,
    evaluateStorefront: evaluateStorefront,
    parseConfigFromDom: parseConfigFromDom,
    applyLockMode: applyLockMode,
    restoreStorefront: restoreStorefront,
    getCachedStatus: getCachedStatus,
    setCachedStatus: setCachedStatus,
    clearCache: clearCache,
    renderLockOverlay: renderLockOverlay,
    renderBanner: renderBanner,
    disableCheckoutActions: disableCheckoutActions,
  };
});

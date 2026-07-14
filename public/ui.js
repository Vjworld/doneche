/**
 * Lightweight, dependency-free UI helpers shared across all pages:
 *  - Toast notifications (success / error / info)
 *  - Button loading-spinner helper for async actions
 *  - Global safety-net so unexpected JS/network errors always surface as a toast
 *    instead of failing silently (or leaking raw "<!DOCTYPE ...">/HTML into the UI).
 */

(function () {
  // ---------- Toast container (created once, reused everywhere) ----------
  function ensureToastContainer() {
    let container = document.getElementById('uiToastContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'uiToastContainer';
      container.className = 'ui-toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Show a toast notification.
   * @param {string} message
   * @param {'success'|'error'|'info'} type
   * @param {number} duration ms before auto-dismiss
   */
  function showToast(message, type, duration) {
    if (!message) return;
    type = type || 'info';
    duration = duration || (type === 'error' ? 6000 : 4000);

    const container = ensureToastContainer();
    const toast = document.createElement('div');
    toast.className = 'ui-toast ui-toast-' + type;

    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = '<span class="ui-toast-icon">' + icon + '</span><span class="ui-toast-msg"></span><button type="button" class="ui-toast-close" aria-label="Dismiss">&times;</button>';
    toast.querySelector('.ui-toast-msg').textContent = message;

    container.appendChild(toast);
    // Force reflow so the CSS transition triggers
    requestAnimationFrame(function () {
      toast.classList.add('show');
    });

    function dismiss() {
      toast.classList.remove('show');
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }

    toast.querySelector('.ui-toast-close').addEventListener('click', dismiss);
    const timer = setTimeout(dismiss, duration);
    toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
  }

  /**
   * Toggle a small inline spinner + disabled state on a button while an
   * async action runs. Preserves original label and restores it afterwards.
   * Usage: const done = setButtonLoading(btn, 'Uploading...'); ... done();
   */
  function setButtonLoading(button, loadingLabel) {
    if (!button) return function () {};
    if (button.dataset.uiLoading === '1') return function () {};
    const originalHtml = button.innerHTML;
    const originalDisabled = button.disabled;
    button.dataset.uiLoading = '1';
    button.disabled = true;
    button.innerHTML = '<span class="ui-spinner" aria-hidden="true"></span> ' + (loadingLabel || 'Loading...');
    return function restore() {
      button.disabled = originalDisabled;
      button.innerHTML = originalHtml;
      delete button.dataset.uiLoading;
    };
  }

  /**
   * Show a full-page lightweight loading overlay (for actions like form
   * submissions that navigate away, or longer-running async calls).
   */
  function showPageLoader(label) {
    let overlay = document.getElementById('uiPageLoader');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'uiPageLoader';
      overlay.className = 'ui-page-loader';
      overlay.innerHTML = '<div class="ui-page-loader-box"><span class="ui-spinner ui-spinner-lg" aria-hidden="true"></span><span class="ui-page-loader-label"></span></div>';
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.ui-page-loader-label').textContent = label || 'Loading...';
    overlay.classList.add('show');
    return function hide() {
      overlay.classList.remove('show');
    };
  }

  // ---------- Global safety net ----------
  // Any uncaught JS error or unhandled promise rejection is surfaced as a
  // toast instead of failing silently, per the "any kind of error is shown
  // as a toast" requirement.
  window.addEventListener('error', function (evt) {
    if (evt && evt.message) {
      showToast(evt.message, 'error');
    }
  });
  window.addEventListener('unhandledrejection', function (evt) {
    const reason = evt && evt.reason;
    const msg = (reason && (reason.message || reason.toString && reason.toString())) || 'Something went wrong.';
    showToast(msg, 'error');
  });

  // Auto-show toasts for query-string flags set by server-side redirects
  // (e.g. /dashboard?feedback=success, /dashboard?limit=1) so backend flows
  // that redirect instead of rendering inline still get a toast.
  document.addEventListener('DOMContentLoaded', function () {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('feedback') === 'success') {
        showToast('Thanks! Your feedback was submitted.', 'success');
      } else if (params.get('feedback') === 'error') {
        showToast('Please select a feedback type and enter a message.', 'error');
      }
      if (params.get('limit') === '1') {
        showToast("You've hit your application limit. Upgrade or invite friends to unlock more slots.", 'error');
      }
      if (params.get('upgrade')) {
        showToast('Upgrade to Pro to unlock this feature.', 'info');
      }
    } catch (e) {
      // URLSearchParams unsupported or malformed query — ignore silently.
    }
  });

  // ---------- Global auto loading-state on form submits ----------
  // Any standard <form> submit (Add Application, Delete, Status change,
  // Feedback, Login, Register, ATS Matcher, etc.) automatically gets a
  // disabled + spinner state on its submit button while the page navigates.
  document.addEventListener('submit', function (evt) {
    const form = evt.target;
    if (!(form instanceof HTMLFormElement)) return;
    const btn = form.querySelector('button[type="submit"], button:not([type])');
    if (btn) setButtonLoading(btn, btn.dataset.loadingLabel || 'Please wait...');
  }, true);

  // Expose globally
  window.showToast = showToast;
  window.setButtonLoading = setButtonLoading;
  window.showPageLoader = showPageLoader;
})();



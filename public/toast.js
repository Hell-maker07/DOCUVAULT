/**
 * DocuVault Toast Notification System
 * Standardized across authentication and application pages.
 * Fully aligned with Warm Architectural Precision design tokens.
 */
window.DocuVaultToast = (function () {
  let container = null;

  function ensureContainer() {
    if (!container || !document.body.contains(container)) {
      container = document.createElement('div');
      container.id = 'dv-toast-container';
      container.className =
        'fixed top-5 right-5 z-50 flex flex-col gap-2.5 max-w-sm w-full pointer-events-none px-4 sm:px-0';
      document.body.appendChild(container);
    }
    return container;
  }

  const ICONS = {
    success: 'verified_user',
    error: 'error',
    warning: 'warning',
    info: 'info',
  };

  const STYLES = {
    success: {
      bg: 'bg-emerald-50/95',
      border: 'border-emerald-200',
      iconColor: 'text-emerald-600',
      titleColor: 'text-emerald-950',
      msgColor: 'text-emerald-800',
    },
    error: {
      bg: 'bg-red-50/95',
      border: 'border-red-200',
      iconColor: 'text-red-600',
      titleColor: 'text-red-950',
      msgColor: 'text-red-800',
    },
    warning: {
      bg: 'bg-amber-50/95',
      border: 'border-amber-200',
      iconColor: 'text-amber-600',
      titleColor: 'text-amber-950',
      msgColor: 'text-amber-800',
    },
    info: {
      bg: 'bg-blue-50/95',
      border: 'border-blue-200',
      iconColor: 'text-dusk-blue',
      titleColor: 'text-indigo-main',
      msgColor: 'text-warm-gray',
    },
  };

  function show({ type = 'info', title = '', message = '', duration = 4500 }) {
    const cont = ensureContainer();
    const style = STYLES[type] || STYLES.info;
    const icon = ICONS[type] || ICONS.info;

    const toast = document.createElement('div');
    toast.className = `pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-lg backdrop-blur-md transition-all duration-300 transform translate-y-2 opacity-0 ${style.bg} ${style.border}`;

    toast.innerHTML = `
      <span class="material-symbols-outlined text-[20px] shrink-0 mt-0.5 ${style.iconColor}">${icon}</span>
      <div class="flex-1 min-w-0">
        ${title ? `<p class="text-xs font-bold leading-snug ${style.titleColor}">${title}</p>` : ''}
        <p class="text-xs leading-relaxed mt-0.5 ${style.msgColor}">${message}</p>
      </div>
      <button type="button" aria-label="Close notification" class="text-warm-gray/70 hover:text-indigo-main transition-colors p-0.5 rounded focus:outline-none">
        <span class="material-symbols-outlined text-[16px]">close</span>
      </button>
    `;

    const closeBtn = toast.querySelector('button');
    function removeToast() {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => {
        if (toast.parentElement) toast.remove();
      }, 300);
    }

    closeBtn.addEventListener('click', removeToast);
    cont.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.remove('opacity-0', 'translate-y-2');
      toast.classList.add('opacity-100', 'translate-y-0');
    });

    if (duration > 0) {
      setTimeout(removeToast, duration);
    }

    return toast;
  }

  return {
    show,
    success: (msg, title = 'Success', duration = 4500) =>
      show({ type: 'success', title, message: msg, duration }),
    error: (msg, title = 'Error', duration = 5000) =>
      show({ type: 'error', title, message: msg, duration }),
    warning: (msg, title = 'Warning', duration = 5000) =>
      show({ type: 'warning', title, message: msg, duration }),
    info: (msg, title = 'Notice', duration = 4500) =>
      show({ type: 'info', title, message: msg, duration }),
  };
})();

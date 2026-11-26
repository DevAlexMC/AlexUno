const DURATION = 5000;
const MAX_VISIBLE = 5;
const active = new Map();
let host = null;
let observer = null;
let sequence = 0;
let installCard = null;
let installState = null;
function installationVisible() {
    return inInstanceSelector() || !!document.querySelector('.panel.settings.active');
}
function syncInstallCard() {
    if (!installCard || !installCard.isConnected)
        return;
    const visible = !!installState && installationVisible();
    if (installCard.hidden !== !visible)
        installCard.hidden = !visible;
    if (visible) {
        installCard.querySelector('.light-install-title').textContent = `Instalando: ${installState.name}`;
        installCard.querySelector('.light-install-status').textContent = installState.status;
        installCard.querySelector('.light-install-percent').textContent = `${installState.percent}%`;
        const fill = installCard.querySelector('.light-install-fill');
        const width = `${installState.percent}%`;
        if (fill.style.width !== width)
            fill.style.width = width;
        installCard.querySelector('.light-install-elapsed').textContent = installState.elapsed;
    }
}
export function setInstallProgress(update) {
    if (update === null) {
        installState = null;
        syncInstallCard();
        return;
    }
    installState = { name: 'Minecraft', status: 'Preparando instalación...', percent: 0, elapsed: '00:00', ...installState, ...update };
    ensureHost();
    if (!installCard || !installCard.isConnected) {
        installCard = document.createElement('section');
        installCard.className = 'light-install-card';
        installCard.setAttribute('role', 'status');
        installCard.innerHTML = '<div class="light-install-title"></div><div class="light-install-meta"><span class="light-install-status"></span><span class="light-install-percent"></span></div><div class="light-install-track"><div class="light-install-fill"></div></div><div class="light-install-elapsed"></div>';
        host.appendChild(installCard);
    }
    syncInstallCard();
}
function orderToasts() {
    if (!host?.isConnected)
        return;
    const items = [...active.values()].filter(e => !e.removing);
    items.sort((a, b) => inInstanceSelector()
        ? a.sequence - b.sequence
        : b.toast.getBoundingClientRect().width - a.toast.getBoundingClientRect().width || a.sequence - b.sequence);
    if (installCard?.isConnected)
        installCard.style.order = '-9999';
    for (let i = 0; i < items.length; i++) {
        const desired = String(i);
        if (items[i].toast.style.order !== desired) {
            items[i].toast.style.order = desired;
        }
    }
}
function inInstanceSelector() {
    const popup = document.querySelector('.instance-popup');
    if (!popup)
        return false;
    const style = getComputedStyle(popup);
    return style.display !== 'none' && style.visibility !== 'hidden';
}
export function syncToastPosition() {
    if (host && host.isConnected) {
        const bottom = inInstanceSelector();
        if (host.classList.contains('light-toast-host-bottom') !== bottom) {
            host.classList.toggle('light-toast-host-bottom', bottom);
        }
        orderToasts();
        syncInstallCard();
    }
}
function ensureHost() {
    if (!host || !host.isConnected) {
        host = document.getElementById('light-toast-host');
        if (!host) {
            host = document.createElement('div');
            host.id = 'light-toast-host';
            host.setAttribute('aria-live', 'polite');
            document.body.appendChild(host);
        }
    }
    if (!observer) {
        observer = new MutationObserver(syncToastPosition);
        observer.observe(document.body, { attributes: true, subtree: true, attributeFilter: ['style', 'class', 'hidden'] });
    }
    syncToastPosition();
    return host;
}
export function notify(message, type = 'info') {
    const safeType = ['info', 'success', 'error', 'warning'].includes(type) ? type : 'info';
    const text = String(message ?? '');
    const key = `${safeType}\u0000${text}`;
    const parent = ensureHost();
    function restart(entry) {
        clearTimeout(entry.timeout);
        entry.bar.style.animation = 'none';
        void entry.bar.offsetWidth;
        entry.bar.style.animation = '';
        entry.timeout = setTimeout(() => remove(entry), DURATION);
    }
    function remove(entry) {
        if (entry.removing)
            return;
        entry.removing = true;
        clearTimeout(entry.timeout);
        if (active.get(entry.key) === entry)
            active.delete(entry.key);
        entry.toast.classList.add('light-toast-leaving');
        setTimeout(() => entry.toast.remove(), 180);
    }
    const existing = active.get(key);
    if (existing && !existing.removing) {
        restart(existing);
        return existing.toast;
    }
    if (active.size >= MAX_VISIBLE) {
        remove(active.values().next().value);
    }
    const toast = document.createElement('div');
    toast.className = `light-toast light-toast-${safeType}`;
    const label = document.createElement('span');
    label.textContent = text;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Cerrar notificación');
    const bar = document.createElement('div');
    bar.className = 'light-toast-timer';
    toast.append(label, close, bar);
    if (inInstanceSelector())
        parent.appendChild(toast);
    else
        parent.prepend(toast);
    const entry = { key, toast, bar, timeout: null, removing: false, sequence: sequence++ };
    active.set(key, entry);
    orderToasts();
    close.addEventListener('click', () => remove(entry), { once: true });
    restart(entry);
    return toast;
}
window.lightNotify = notify;

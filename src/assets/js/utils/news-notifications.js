import config from './config.js';
const KEY = 'hexa-news-seen-v1';
let ids = [];
let lastResult = null;
let pending = null;
function seen() { try {
    const x = JSON.parse(localStorage.getItem(KEY) || '[]');
    return new Set(Array.isArray(x) ? x : []);
}
catch {
    return new Set();
} }
function idOf(n) { return String(n.id ?? (String(n.title || '') + '|' + String(n.publish_date || '') + '|' + String(n.image_title || ''))); }
function paint() {
    const s = seen();
    const count = ids.filter(x => !s.has(x)).length;
    const badge = document.getElementById('light-home-news-badge');
    if (badge) {
        badge.hidden = !count;
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.setAttribute('aria-label', `${count} noticias nuevas`);
    }
    const tab = document.getElementById('news');
    if (tab) {
        tab.classList.toggle('light-news-unread', count > 0);
        const b = tab.querySelector('.light-settings-news-badge');
        if (b) {
            b.hidden = !count;
            b.textContent = count > 99 ? '99+' : String(count);
        }
    }
}
export function refreshNewsBadges() { paint(); }
export async function checkNewsNotifications() {
    if (pending)
        return pending;
    pending = (async () => {
        try {
            const result = await config.getNews();
            lastResult = result;
            const enabled = !(result && !Array.isArray(result) && result.enabled === false);
            const news = (Array.isArray(result) ? result : (Array.isArray(result?.news) ? result.news : [])).filter(n => n && typeof n === 'object' && n.enabled !== false);
            ids = enabled ? [...new Set(news.filter(n => n && typeof n === 'object').map(idOf))] : [];
            paint();
            return result;
        }
        catch (err) {
            console.warn('Error consultando novedades:', err);
            return null;
        }
        finally {
            pending = null;
        }
    })();
    return pending;
}
export function markNewsAsRead(result = lastResult) {
    if (!result)
        return;
    const news = (Array.isArray(result) ? result : (Array.isArray(result.news) ? result.news : [])).filter(n => n && typeof n === 'object' && n.enabled !== false);
    if (!Array.isArray(result) && result.enabled === false)
        return;
    const s = seen();
    for (const n of news)
        if (n && typeof n === 'object')
            s.add(idOf(n));
    try {
        localStorage.setItem(KEY, JSON.stringify([...s]));
    }
    catch (err) {
        console.warn('No se guardó el estado de noticias:', err);
    }
    ids = [...new Set(news.filter(n => n && typeof n === 'object').map(idOf))];
    paint();
}

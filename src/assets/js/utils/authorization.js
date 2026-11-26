import database from './database.js';
const fetch = require('node-fetch');
let endpoint;
export function configureAuthorization(cfg) { endpoint = cfg.authorizationUrl || ''; }
export async function selectedAccount() {
    const db = new database();
    const cfg = await db.readData('configClient');
    return cfg?.account_selected ? db.readData('accounts', cfg.account_selected) : null;
}
export async function checkAuthorization(code = '', candidate = null) {
    const account = candidate || await selectedAccount();
    if (!account)
        return { allowed: false, reason: 'no_account' };
    const name = String(account.name || account.profile?.name || '');
    const uuid = String(account.uuid || account.profile?.id || '').replace(/-/g, '').toLowerCase();
    if (!/^[A-Za-z0-9_]{1,16}$/.test(name) || !/^[a-f0-9]{32}$/.test(uuid))
        return { allowed: false, reason: 'session' };
    const key = 'light-general-access-v48:' + uuid;
    try {
        const url = new URL(endpoint);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            throw new Error('URL inválida');
        const response = await fetch(url.href, { method: 'POST', redirect: 'error', timeout: 12000,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, uuid, code, receipt: localStorage.getItem(key) || '' }) });
        const result = await response.json();
        if (!response.ok || typeof result.allowed !== 'boolean')
            throw new Error('Respuesta inválida');
        const current = await selectedAccount();
        if (!candidate && (!current || String(current.ID) !== String(account.ID)))
            return { allowed: false, reason: 'changed' };
        if (!candidate && result.allowed && typeof result.receipt === 'string')
            localStorage.setItem(key, result.receipt);
        return result;
    }
    catch (error) {
        console.warn('[Authorization] Error de conexión:', error.name, error.code || '');
        return { allowed: false, reason: 'connection' };
    }
}
export function showAuthorizationStatus(result, account) {
    const name = document.querySelector('#light-auth-name');
    const status = document.querySelector('#light-auth-status');
    if (name)
        name.textContent = account?.name || 'Sin cuenta';
    if (status)
        status.textContent = result.reason === 'banned' ? 'Este usuario está baneado de este cliente.' : result.reason === 'config' ? 'El servidor no tiene configurada la autorización. Contacta al administrador.' : result.reason === 'connection' ? 'No se pudo comprobar la autorización. Revisa la conexión o contacta al administrador.' : result.reason === 'session' ? 'Tu sesión ha caducado. Vuelve a iniciar sesión.' : 'Esperando autorización del administrador.';
}

/**
 * @author DevAlex
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
const { ipcRenderer } = require('electron');
const { Status } = require('minecraft-java-core');
const fs = require('fs');
const pkg = require('../package.json');
import config from './utils/config.js';
import database from './utils/database.js';
import logger from './utils/logger.js';
import popup from './utils/popup.js';
import { skin2D } from './utils/skin.js';
import slider from './utils/slider.js';
import { notify } from './utils/toast.js';
import { checkAuthorization, selectedAccount, showAuthorizationStatus } from './utils/authorization.js';
let panelRequest = 0;
const pendingAuthorizationKey = 'light-auth-return-to-login';
function rememberAuthorizationPanel(active) {
    try {
        if (active)
            localStorage.setItem(pendingAuthorizationKey, '1');
        else
            localStorage.removeItem(pendingAuthorizationKey);
    }
    catch (error) {
        console.warn('[Authorization] No se pudo guardar el estado del panel.');
    }
}
const definitiveDenial = result => ['banned', 'not_whitelisted', 'invalid_code', 'session'].includes(result.reason);
let signingOut = false;
async function revokeSession(result, expected) {
    if (signingOut)
        return;
    signingOut = true;
    try {
        const db = new database();
        const cfg = await db.readData('configClient');
        if (!cfg || !expected || String(cfg.account_selected) !== String(expected.ID))
            return;
        localStorage.setItem('light-auth-force-login', '1');
        cfg.account_selected = null;
        await db.updateData('configClient', cfg);
        await db.deleteData('accounts', expected.ID);
        await changePanel('login');
        window.dispatchEvent(new Event('light-accounts-changed'));
        notify(result.reason === 'banned' ? 'Esta cuenta ha sido baneada de este cliente.' : 'Tu autorización ha sido revocada. Vuelve a iniciar sesión.', 'error');
    }
    finally {
        signingOut = false;
    }
}
let monitoring = false;
setInterval(async () => {
    if (monitoring || signingOut || !document.querySelector('.panel.home.active, .panel.settings.active'))
        return;
    monitoring = true;
    const request = panelRequest;
    try {
        const account = await selectedAccount();
        if (!account)
            return;
        const result = await checkAuthorization();
        if (request !== panelRequest || !document.querySelector('.panel.home.active, .panel.settings.active'))
            return;
        if (!result.allowed && definitiveDenial(result))
            await revokeSession(result, account);
    }
    catch (error) {
        console.warn('[Authorization] Monitor:', error);
    }
    finally {
        monitoring = false;
    }
}, 3000);
async function setBackground(theme) {
    let body = document.body;
    body.className = theme ? 'dark global' : 'light global';
    let backgroundPath = './assets/images/background/dark/1.png';
    body.style.backgroundImage = `linear-gradient(#00000000, #00000080), url(${backgroundPath})`;
    body.style.backgroundSize = 'cover';
}
async function changePanel(id, verified = null, restoring = false) {
    const request = ++panelRequest;
    if (id === 'home' || id === 'settings') {
        const account = await selectedAccount();
        if (request !== panelRequest)
            return;
        if (!account)
            return changePanel('login');
        const result = verified || await checkAuthorization();
        if (request !== panelRequest)
            return;
        if (!result.allowed) {
            const current = await selectedAccount();
            if (request !== panelRequest)
                return;
            if (current && (result.reason === 'banned' || (definitiveDenial(result) && (restoring || document.querySelector('.panel.home.active, .panel.settings.active')))))
                return revokeSession(result, current);
            id = current ? 'authorization' : 'login';
            if (current)
                showAuthorizationStatus(result, current);
        }
    }
    let panel = document.querySelector(`.${id}`);
    if (!panel)
        return;
    let active = document.querySelector(`.active`);
    if (active)
        active.classList.remove("active");
    if (id === 'settings' || id === 'login') {
        await setBackground(false);
    }
    try {
        if (id !== 'settings') {
            const activeSettingsBTN = document.querySelector('.active-settings-BTN');
            const activeContainerSettings = document.querySelector('.active-container-settings');
            if (activeSettingsBTN)
                activeSettingsBTN.classList.remove('active-settings-BTN');
            if (activeContainerSettings)
                activeContainerSettings.classList.remove('active-container-settings');
            const cancelHome = document.querySelector('.cancel-home');
            if (cancelHome)
                cancelHome.style.display = 'none';
        }
    }
    catch (err) {
        console.error('changePanel cleanup error', err);
    }
    try {
        const panels = document.querySelectorAll('.panel');
        panels.forEach(p => {
            if (p === panel) {
                p.style.display = 'block';
            }
            else {
                p.style.display = 'none';
                p.classList.remove('active');
            }
        });
    }
    catch (err) {
    }
    panel.classList.add("active");
    rememberAuthorizationPanel(id === 'authorization');
    ipcRenderer.send('panel-changed', { panelName: id });
}
async function appdata() {
    return await ipcRenderer.invoke('appData').then(path => path);
}
async function addAccount(data) {
    let skin = false;
    if (data?.profile?.skins[0]?.base64)
        skin = await new skin2D().creatHeadTexture(data.profile.skins[0].base64);
    let div = document.createElement("div");
    div.classList.add("account");
    div.id = data.ID;
    div.innerHTML = `
        <div class="profile-image" ${skin ? 'style="background-image: url(' + skin + ');"' : ''}></div>
        <div class="profile-infos">
            <div class="profile-pseudo">${data.name}</div>
            <div class="profile-uuid">${data.uuid}</div>
        </div>
        <div class="delete-profile" id="${data.ID}">
            <div class="icon-account-delete delete-profile-icon"></div>
        </div>
    `;
    let list = document.querySelector('.accounts-list');
    if (!list) {
        list = document.createElement('div');
        list.className = 'accounts-list light-legacy-accounts';
        list.hidden = true;
        list.style.display = 'none';
        document.body.appendChild(list);
    }
    return list.appendChild(div);
}
async function accountSelect(data) {
    let account = document.getElementById(`${data.ID}`);
    let activeAccount = document.querySelector('.account-select');
    if (activeAccount)
        activeAccount.classList.toggle('account-select');
    if (account)
        account.classList.add('account-select');
    const key = String(data.uuid || data.id || data.name || data.ID || '');
    let saved = null;
    try {
        saved = localStorage.getItem('hexa-sidebar-skin:' + key);
    }
    catch (_) { }
    const original = data?.profile?.skins?.[0]?.base64;
    if (saved || original)
        void headplayer(saved || original);
}
let sidebarSkinSerial = 0;
async function headplayer(skinBase64) {
    const serial = ++sidebarSkinSerial;
    let skin = await new skin2D().creatBustTexture(skinBase64);
    if (serial !== sidebarSkinSerial)
        return;
    const head = document.querySelector(".player-head");
    if (head) {
        head.style.backgroundImage = `url(${skin})`;
        head.classList.add('player-bust');
    }
}
window.addEventListener('light-skin-updated', event => {
    const { accountKey, skinDataUrl } = event.detail || {};
    if (!accountKey || !skinDataUrl)
        return;
    try {
        localStorage.setItem('hexa-sidebar-skin:' + accountKey, skinDataUrl);
    }
    catch (error) {
        console.warn('Cache de skin 2D:', error);
    }
    void headplayer(skinDataUrl).catch(error => console.warn('Avatar 2D:', error));
});
let latestStatusRequest = 0;
async function setStatus(opt, instanceName = null) {
    const requestId = ++latestStatusRequest;
    const nameEl = document.querySelector('.server-status-name');
    const statusEl = document.querySelector('.server-status-text');
    const countWrap = document.querySelector('.status-player-count');
    const countEl = document.querySelector('.status-player-count .player-count');
    if (nameEl)
        nameEl.textContent = instanceName || opt?.nameServer || 'Light Studio';
    if (!statusEl)
        return;
    const showOffline = () => {
        if (requestId !== latestStatusRequest)
            return;
        statusEl.classList.add('red');
        statusEl.textContent = 'Fuera de línea - 0 ms';
        if (countWrap)
            countWrap.classList.add('red');
        if (countEl)
            countEl.textContent = '0';
    };
    if (!opt?.ip) {
        showOffline();
        return;
    }
    try {
        const response = await new Status(opt.ip, opt.port).getStatus();
        if (requestId !== latestStatusRequest)
            return;
        if (!response || response.error) {
            showOffline();
            return;
        }
        statusEl.classList.remove('red');
        statusEl.textContent = `En línea - ${response.ms} ms`;
        if (countWrap)
            countWrap.classList.remove('red');
        if (countEl)
            countEl.textContent = String(response.playersConnect ?? 0);
    }
    catch (error) {
        showOffline();
    }
}
export { revokeSession, appdata as appdata, changePanel as changePanel, config as config, database as database, logger as logger, popup as popup, setBackground as setBackground, skin2D as skin2D, addAccount as addAccount, accountSelect as accountSelect, slider as Slider, pkg as pkg, setStatus as setStatus };

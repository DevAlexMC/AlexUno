/**
 * @author DevAlex
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { initLanguage, syncLanguageSelector } from './utils/language.js';
import Login from './panels/login.js';
import Home from './panels/home.js';
import Settings from './panels/settings.js';
import Authorization from './panels/authorization.js';
import { configureAuthorization } from './utils/authorization.js';
import { logger, config, changePanel, database, popup, setBackground, accountSelect, addAccount, pkg } from './utils.js';
const { AZauth, Microsoft, Mojang } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');
const fs = require('fs');
class Launcher {
    async init() {
        initLanguage();
        this.initLog();
        console.log('Initializing Launcher...');
        this.shortcut();
        await setBackground();
        this.config = await config.GetConfig().then(res => res).catch(err => err);
        if (await this.config.error)
            return this.errorConnect();
        this.db = new database();
        await this.initConfigClient();
        configureAuthorization(this.config);
        this.createPanels(Login, Home, Settings, Authorization);
        syncLanguageSelector();
        this.startLauncher();
    }
    initLog() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.keyCode == 73 || e.keyCode == 123) {
                ipcRenderer.send('main-window-dev-tools-close');
                ipcRenderer.send('main-window-dev-tools');
            }
        });
        new logger(pkg.name, '#7289da');
    }
    shortcut() {
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.keyCode == 87) {
                ipcRenderer.send('main-window-close');
            }
        });
    }
    errorConnect() {
        new popup().openPopup({
            title: this.config.error.code,
            content: this.config.error.message,
            color: 'red',
            exit: true,
            options: true
        });
    }
    async initConfigClient() {
        console.log('Initializing Config Client...');
        let configClient = await this.db.readData('configClient');
        if (!configClient) {
            await this.db.createData('configClient', {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: {
                        min: 2,
                        max: 4
                    }
                },
                game_config: {
                    screen_size: {
                        width: 854,
                        height: 480
                    }
                },
                launcher_config: {
                    download_multi: 5,
                    theme: 'auto',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            });
        }
    }
    createPanels(...panels) {
        let panelsElem = document.querySelector('.panels');
        for (let panel of panels) {
            console.log(`Initializing ${panel.name} Panel...`);
            let div = document.createElement('div');
            div.classList.add('panel', panel.id);
            div.innerHTML = fs.readFileSync(`${__dirname}/panels/${panel.id}.html`, 'utf8');
            panelsElem.appendChild(div);
            new panel().init(this.config);
        }
    }
    async startLauncher() {
        if (localStorage.getItem('light-auth-return-to-login') === '1') {
            const cfg = await this.db.readData('configClient');
            if (cfg) {
                const selected = cfg.account_selected;
                cfg.account_selected = null;
                await this.db.updateData('configClient', cfg);
                if (selected != null)
                    await this.db.deleteData('accounts', selected);
            }
            localStorage.setItem('light-auth-force-login', '1');
            return changePanel('login');
        }
        if (localStorage.getItem('light-auth-force-login') === '1')
            return changePanel('login');
        let accounts = await this.db.readAllData('accounts');
        let configClient = await this.db.readData('configClient');
        let account_selected = configClient ? configClient.account_selected : null;
        let popupRefresh = new popup();
        let microsoftRefreshFailed = false;
        if (accounts?.length) {
            for (let account of accounts) {
                let account_ID = account.ID;
                if (account.error) {
                    await this.db.deleteData('accounts', account_ID);
                    continue;
                }
                if (account.meta.type === 'Xbox') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Conectando...',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    const expiry = Number(account.meta?.access_token_expires_in);
                    const now = Math.floor(Date.now() / 1000);
                    if (account.access_token && Number.isFinite(expiry) && expiry - now > 7200) {
                        await addAccount(account);
                        if (String(account_ID) === String(account_selected))
                            await accountSelect(account);
                        continue;
                    }
                    let refresh_accounts;
                    try {
                        refresh_accounts = await new Microsoft(this.config.client_id).refresh(account);
                    }
                    catch (err) {
                        microsoftRefreshFailed = true;
                        console.warn(`[Account] No se pudo renovar la sesión Microsoft de ${account.name}. Se conserva la cuenta local.`, err?.message || String(err));
                        continue;
                    }
                    if (!refresh_accounts || refresh_accounts.error) {
                        microsoftRefreshFailed = true;
                        console.warn(`[Account] Error al renovar Microsoft de ${account.name}. Se conserva la cuenta local. Código: ${refresh_accounts?.errorCode || refresh_accounts?.code || 'desconocido'}`);
                        continue;
                    }
                    if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                        refresh_accounts.name = refresh_accounts.profile.name;
                    }
                    if (!refresh_accounts.name) {
                        microsoftRefreshFailed = true;
                        console.warn(`[Account] La renovación de ${account.name} no devolvió nombre. Se conserva la cuenta local.`);
                        continue;
                    }
                    refresh_accounts.ID = account_ID;
                    await this.db.updateData('accounts', refresh_accounts, account_ID);
                    await addAccount(refresh_accounts);
                    if (account_ID == account_selected)
                        accountSelect(refresh_accounts);
                }
                else if (account.meta.type == 'AZauth') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Conectando',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    let refresh_accounts = await new AZauth(this.config.online).verify(account);
                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            await this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.message}`);
                        continue;
                    }
                    if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                        refresh_accounts.name = refresh_accounts.profile.name;
                        console.log(`[Launcher] AZauth account refreshed and normalized: name=${refresh_accounts.name}`);
                    }
                    if (!refresh_accounts.name) {
                        console.error(`[Account] ${account.name}: Refreshed account missing name property`, refresh_accounts);
                        await this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            await this.db.updateData('configClient', configClient);
                        }
                        continue;
                    }
                    refresh_accounts.ID = account_ID;
                    await this.db.updateData('accounts', refresh_accounts, account_ID);
                    await addAccount(refresh_accounts);
                    if (account_ID == account_selected)
                        accountSelect(refresh_accounts);
                }
                else if (account.meta.type == 'Mojang') {
                    console.log(`Account Type: ${account.meta.type} | Username: ${account.name}`);
                    popupRefresh.openPopup({
                        title: 'Connexion',
                        content: `Refresh account Type: ${account.meta.type} | Username: ${account.name}`,
                        color: 'var(--color)',
                        background: false
                    });
                    if (account.meta.online == false) {
                        let refresh_accounts = await Mojang.login(account.name);
                        if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                            refresh_accounts.name = refresh_accounts.profile.name;
                        }
                        refresh_accounts.ID = account_ID;
                        await addAccount(refresh_accounts);
                        await this.db.updateData('accounts', refresh_accounts, account_ID);
                        if (account_ID == account_selected)
                            accountSelect(refresh_accounts);
                        continue;
                    }
                    let refresh_accounts = await Mojang.refresh(account);
                    if (refresh_accounts.error) {
                        await this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            await this.db.updateData('configClient', configClient);
                        }
                        console.error(`[Account] ${account.name}: ${refresh_accounts.errorMessage}`);
                        continue;
                    }
                    if (!refresh_accounts.name && refresh_accounts.profile?.name) {
                        refresh_accounts.name = refresh_accounts.profile.name;
                        console.log(`[Launcher] Mojang account refreshed and normalized: name=${refresh_accounts.name}`);
                    }
                    if (!refresh_accounts.name) {
                        console.error(`[Account] ${account.name}: Refreshed account missing name property`, refresh_accounts);
                        await this.db.deleteData('accounts', account_ID);
                        if (account_ID == account_selected) {
                            configClient.account_selected = null;
                            await this.db.updateData('configClient', configClient);
                        }
                        continue;
                    }
                    refresh_accounts.ID = account_ID;
                    await this.db.updateData('accounts', refresh_accounts, account_ID);
                    await addAccount(refresh_accounts);
                    if (account_ID == account_selected)
                        accountSelect(refresh_accounts);
                }
                else {
                    console.error(`[Account] ${account.name}: Account Type Not Found`);
                    this.db.deleteData('accounts', account_ID);
                    if (account_ID == account_selected) {
                        configClient.account_selected = null;
                        this.db.updateData('configClient', configClient);
                    }
                }
            }
            accounts = await this.db.readAllData('accounts');
            configClient = await this.db.readData('configClient');
            account_selected = configClient ? configClient.account_selected : null;
            if (!accounts.length) {
                configClient.account_selected = null;
                await this.db.updateData('configClient', configClient);
                popupRefresh.closePopup();
                return changePanel('login');
            }
            if (!account_selected || !accounts.some(a => String(a.ID) === String(account_selected))) {
                const firstAccount = accounts[0];
                configClient.account_selected = firstAccount.ID;
                await this.db.updateData('configClient', configClient);
                await accountSelect(firstAccount);
            }
            popupRefresh.closePopup();
            if (microsoftRefreshFailed) {
                console.warn('[Launcher] No se pudo validar al menos una sesión Microsoft. Las cuentas guardadas se conservaron; vuelve a intentar cuando termine el límite de solicitudes.');
                return changePanel('login');
            }
            changePanel("home", null, true);
        }
        else {
            popupRefresh.closePopup();
            changePanel('login');
        }
    }
}
new Launcher().init();

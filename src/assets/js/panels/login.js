import { checkAuthorization } from '../utils/authorization.js';
import { notify } from '../utils/toast.js';
const { AZauth } = require('minecraft-java-core');
const { ipcRenderer } = require('electron');
import { popup, database, changePanel, accountSelect, addAccount, config, setStatus } from '../utils.js';
class Login {
    static id = "login";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.microsoftLoginPending = false;
        this.showTab('.login-select');
        document.querySelector('.select-microsoft').addEventListener('click', () => {
            this.showMicrosoftLogin();
        });
        document.querySelector('.select-offline')?.remove();
        const cancelAZauth = document.querySelector('.cancel-AZauth');
        if (cancelAZauth) {
            cancelAZauth.addEventListener('click', () => {
                this.showTab('.login-select');
            });
        }
        const cancelAZauthA2F = document.querySelector('.cancel-AZauth-A2F');
        if (cancelAZauthA2F) {
            cancelAZauthA2F.addEventListener('click', () => {
                this.showTab('.login-select');
            });
        }
    }
    showTab(selector) {
        document.querySelectorAll('.login-tabs').forEach(tab => {
            tab.style.display = 'none';
        });
        const tab = document.querySelector(selector);
        if (tab)
            tab.style.display = 'block';
    }
    showMicrosoftLogin() {
        void this.getMicrosoft();
    }
    async getMicrosoft() {
        if (this.microsoftLoginPending || window.lightMicrosoftLoginPending)
            return;
        this.microsoftLoginPending = true;
        window.lightMicrosoftLoginPending = true;
        console.log('Initializing Microsoft login...');
        notify('Conectando con Microsoft…', 'info');
        try {
            const account_connect = await ipcRenderer.invoke('Microsoft-window', this.config.client_id);
            if (!account_connect || account_connect === 'cancel' || account_connect === false) {
                return;
            }
            await this.saveData(account_connect);
        }
        catch (err) {
            console.warn('[Microsoft login] Error:', String(err?.message || 'Error desconocido'));
            notify(String(err?.message || 'No se pudo iniciar sesión.'), 'error');
        }
        finally {
            this.microsoftLoginPending = false;
            window.lightMicrosoftLoginPending = false;
        }
    }
    async getAZauth() {
    }
    async saveData(connectionData) {
        if (!connectionData || connectionData === 'cancel') {
            throw new Error('Microsoft no devolvió una cuenta. Intenta iniciar sesión otra vez.');
        }
        if (connectionData.error) {
            const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,90}$/.test(value) ? value : '';
            const code = safe(connectionData.errorCode) || safe(connectionData.code) || 'SIN_CODIGO';
            const kind = safe(connectionData.error) || 'ERROR';
            const stage = safe(connectionData.stage) || 'getAuth';
            console.warn('[Microsoft] Autenticación fallida:', { code, kind, stage });
            throw new Error(`Minecraft no completó la autenticación. Código: ${code}; tipo: ${kind}; etapa: ${stage}. Revisa la consola para más detalles.`);
        }
        if (!connectionData.name && !connectionData.profile?.name) {
            throw new Error('Microsoft no devolvió un perfil de Minecraft Java válido. Comprueba que esta cuenta tenga Minecraft Java.');
        }
        if (!connectionData.name && connectionData.profile?.name) {
            connectionData.name = connectionData.profile.name;
            console.log(`[Login] Microsoft account normalized: name=${connectionData.name}`);
        }
        if (!connectionData.name) {
            console.warn('[Login] La cuenta no tiene nombre.');
        }
        const access = await checkAuthorization('', connectionData);
        if (access.reason === 'banned') {
            notify('Esta cuenta ha sido baneada de este cliente.', 'error');
            return;
        }
        const configClient = await this.db.readData('configClient') || {};
        const stored = await this.db.readAllData('accounts') || [];
        const identity = String(connectionData.uuid || connectionData.profile?.id || '').replace(/-/g, '').toLowerCase();
        const existing = identity
            ? stored.find(item => String(item.uuid || item.profile?.id || '').replace(/-/g, '').toLowerCase() === identity)
            : null;
        const account = existing
            ? { ...existing, ...connectionData, ID: existing.ID }
            : await this.db.createData('accounts', connectionData);
        if (existing)
            await this.db.updateData('accounts', account, account.ID);
        if (!account.name && account.profile?.name) {
            account.name = account.profile.name;
            console.log(`[Login] Account name needed re-normalization after createData: ${account.name}`);
            await this.db.updateData('accounts', account, account.ID);
        }
        const instanceSelect = configClient.instance_selct;
        const instancesList = await config.getInstanceList();
        configClient.account_selected = account.ID;
        try {
            for (let instance of instancesList) {
                if (instance.whitelistActive) {
                    const whitelist = instance.whitelist.find(u => u === account.name);
                    if (whitelist !== account.name && instance.name === instanceSelect) {
                        const newInstanceSelect = instancesList.find(i => !i.whitelistActive);
                        if (newInstanceSelect) {
                            configClient.instance_selct = newInstanceSelect.name;
                            await setStatus(newInstanceSelect.status);
                        }
                    }
                }
            }
        }
        catch (err) {
            console.warn('Error while adjusting instance selection for new account:', err);
        }
        await this.db.updateData('configClient', configClient);
        window.dispatchEvent(new Event('light-accounts-changed'));
        notify('Sesión iniciada correctamente.', 'success');
        try {
            await addAccount(account);
        }
        catch (err) {
            console.warn('addAccount failed (UI list update) but account was created:', err);
        }
        try {
            await accountSelect(account);
        }
        catch (err) {
            console.warn('accountSelect failed (UI selection) but account was created:', err);
        }
        const latestConfig = await this.db.readData('configClient') || {};
        latestConfig.account_selected = account.ID;
        await this.db.updateData('configClient', latestConfig);
        window.dispatchEvent(new Event('light-accounts-changed'));
        try {
            localStorage.removeItem('light-auth-force-login');
            await changePanel('home');
        }
        catch (err) {
            console.error('changePanel to home failed after login:', err);
        }
        return account;
    }
}
export default Login;

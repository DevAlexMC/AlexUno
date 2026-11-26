/**
 * @author DevAlex
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
import { notify } from '../utils/toast.js';
import { changePanel, accountSelect, database, Slider, config, setStatus, popup, appdata, setBackground } from '../utils.js';
import { checkNewsNotifications, markNewsAsRead, refreshNewsBadges } from '../utils/news-notifications.js';
const { ipcRenderer } = require('electron');
const os = require('os');
class Settings {
    static id = "settings";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.navBTN();
        this.accounts();
        this.ram();
        this.profileSummary();
        this.newsPanel();
        refreshNewsBadges();
        this.appearancePanel();
    }
    navBTN() {
        document.querySelector('.settings-tabs').addEventListener('click', e => {
            const tab = e.target.closest('.settings-tab');
            if (tab) {
                let id = tab.id;
                let activeSettingsBTN = document.querySelector('.active-tab');
                let activeContainerSettings = document.querySelector('.active-panel');
                if (activeSettingsBTN)
                    activeSettingsBTN.classList.remove('active-tab');
                tab.classList.add('active-tab');
                if (activeContainerSettings)
                    activeContainerSettings.classList.remove('active-panel');
                document.getElementById(`${id}-tab`)?.classList.add('active-panel');
                if (id === 'java')
                    document.getElementById('light-ram-range')?.dispatchEvent(new Event('input'));
                if (id === 'news')
                    this.loadNews();
                if (id === 'account') {
                    void this.renderAccounts();
                    void this.profileSummary();
                }
            }
        });
        const saveBtn = document.querySelector('#save.settings-close-btn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                let activeSettingsBTN = document.querySelector('.active-tab');
                let activeContainerSettings = document.querySelector('.active-panel');
                if (activeSettingsBTN)
                    activeSettingsBTN.classList.remove('active-tab');
                document.querySelector('#account').classList.add('active-tab');
                if (activeContainerSettings)
                    activeContainerSettings.classList.remove('active-panel');
                document.querySelector(`#account-tab`).classList.add('active-panel');
                const cancelHome = document.querySelector('.cancel-home');
                if (cancelHome)
                    cancelHome.style.display = 'none';
                changePanel('home');
            });
        }
    }
    accounts() {
        const feedback = document.getElementById('light-account-feedback');
        const list = document.getElementById('light-account-cards');
        const addButton = document.getElementById('light-add-account');
        addButton?.addEventListener('click', async () => {
            if (addButton.disabled || window.lightMicrosoftLoginPending)
                return;
            window.lightMicrosoftLoginPending = true;
            addButton.disabled = true;
            if (feedback)
                feedback.textContent = 'Abriendo Microsoft...';
            try {
                const connection = await ipcRenderer.invoke('Microsoft-window', this.config.client_id);
                if (!connection || connection === 'cancel') {
                    if (feedback)
                        feedback.textContent = 'Inicio de sesión cancelado.';
                    return;
                }
                if (connection.error)
                    throw new Error('Microsoft no completó la autenticación. Inténtalo más tarde.');
                if (!connection.name && !connection.profile?.name)
                    throw new Error('Microsoft no devolvió un perfil de Minecraft Java válido.');
                if (!connection.name && connection.profile?.name)
                    connection.name = connection.profile.name;
                const existing = await this.db.readAllData('accounts') || [];
                const duplicate = existing.find(a => String(a.uuid || a.id || a.name).toLowerCase() === String(connection.uuid || connection.id || connection.name).toLowerCase());
                const account = duplicate ? { ...duplicate, ...connection, ID: duplicate.ID } : await this.db.createData('accounts', connection);
                if (duplicate)
                    await this.db.updateData('accounts', account, account.ID);
                const cfg = await this.setInstance(account);
                cfg.account_selected = account.ID;
                await this.db.updateData('configClient', cfg);
                await changePanel('settings');
                await accountSelect(account);
                await this.renderAccounts();
                await this.profileSummary();
                await this.refreshSkinPlayerName();
                window.dispatchEvent(new Event('light-accounts-changed'));
                if (feedback)
                    feedback.textContent = `Cuenta ${account.name || 'Microsoft'} añadida y seleccionada.`;
                window.dispatchEvent(new Event('instances-updated'));
            }
            catch (error) {
                console.error('Microsoft:', error);
                if (feedback)
                    feedback.textContent = error.message || 'Error al añadir la cuenta.';
            }
            finally {
                addButton.disabled = false;
                window.lightMicrosoftLoginPending = false;
            }
        });
        list?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-account-action]');
            if (!button || button.disabled)
                return;
            const action = button.dataset.accountAction;
            const id = button.dataset.accountId;
            if (!id)
                return;
            if (action === 'remove' && (window.lightInstanceInstalling || window.lightInstanceRunning)) {
                notify(window.lightInstanceRunning
                    ? 'No puedes cerrar sesión mientras Minecraft está abierto.'
                    : 'No puedes cerrar sesión mientras se instala una instancia.', 'warning');
                return;
            }
            button.disabled = true;
            try {
                if (action === 'remove') {
                    await this.db.deleteData('accounts', id);
                    const cfg = await this.db.readData('configClient') || {};
                    if (String(cfg.account_selected) === id) {
                        const remaining = await this.db.readAllData('accounts') || [];
                        cfg.account_selected = remaining[0]?.ID || null;
                        if (remaining[0]) {
                            const adjusted = await this.setInstance(remaining[0]);
                            cfg.instance_selct = adjusted.instance_selct;
                            await accountSelect(remaining[0]);
                        }
                        await this.db.updateData('configClient', cfg);
                        if (remaining.length)
                            await changePanel('settings');
                        if (!remaining.length) {
                            await this.renderAccounts();
                            await this.profileSummary();
                            document.querySelectorAll('.login-tabs').forEach(tab => {
                                tab.style.display = 'none';
                            });
                            const loginSelect = document.querySelector('.login-select');
                            if (loginSelect)
                                loginSelect.style.display = 'block';
                            window.dispatchEvent(new Event('light-accounts-changed'));
                            changePanel('login');
                            return;
                        }
                    }
                    if (feedback)
                        feedback.textContent = 'Sesión cerrada en el launcher.';
                }
                else if (action === 'select') {
                    const account = await this.db.readData('accounts', id);
                    if (!account)
                        throw new Error('No se encontró la cuenta.');
                    const cfg = await this.setInstance(account);
                    cfg.account_selected = account.ID;
                    await this.db.updateData('configClient', cfg);
                    await changePanel('settings');
                    await accountSelect(account);
                    if (feedback)
                        feedback.textContent = `Cuenta ${account.name || 'Microsoft'} seleccionada.`;
                    window.dispatchEvent(new Event('instances-updated'));
                }
                await this.renderAccounts();
                await this.profileSummary();
            }
            catch (error) {
                console.error(error);
                if (feedback)
                    feedback.textContent = error.message || 'No se pudo actualizar la cuenta.';
            }
            finally {
                button.disabled = false;
            }
        });
        window.addEventListener('light-accounts-changed-selection', () => { void this.refreshSkinPlayerName(); });
        window.addEventListener('light-accounts-changed', () => {
            void this.renderAccounts().then(() => this.refreshSkinPlayerName());
            void this.profileSummary();
        });
        void this.renderAccounts().then(() => this.refreshSkinPlayerName());
    }
    async renderAccounts() {
        const list = document.getElementById('light-account-cards');
        if (!list)
            return;
        const cfg = await this.db.readData('configClient') || {};
        const storedAccounts = await this.db.readAllData('accounts') || [];
        const selectedExists = storedAccounts.some(a => String(a.ID) === String(cfg.account_selected));
        if (!selectedExists && storedAccounts.length && localStorage.getItem('light-auth-force-login') !== '1' && localStorage.getItem('light-auth-return-to-login') !== '1') {
            const restored = storedAccounts[0];
            cfg.account_selected = restored.ID;
            await this.db.updateData('configClient', cfg);
            await accountSelect(restored);
            window.dispatchEvent(new Event('light-accounts-changed-selection'));
        }
        const seenAccounts = new Set();
        const accounts = storedAccounts.filter(account => {
            const identity = String(account.uuid || account.profile?.id || account.id || account.name || account.ID).replace(/-/g, '').toLowerCase();
            if (seenAccounts.has(identity))
                return false;
            seenAccounts.add(identity);
            return true;
        });
        list.replaceChildren();
        if (!accounts.length) {
            const empty = document.createElement('p');
            empty.className = 'light-empty-accounts';
            empty.textContent = 'Todavía no tienes cuentas. Pulsa «Añadir cuenta Microsoft» para comenzar.';
            list.append(empty);
        }
        for (const account of accounts) {
            const active = String(cfg.account_selected) === String(account.ID);
            const card = document.createElement('article');
            card.className = `light-account-row light-account-tile${active ? ' is-selected' : ''}`;
            const identity = account.uuid || account.profile?.id || account.id || '';
            const avatarColumn = document.createElement('div');
            avatarColumn.className = 'light-account-avatar-column';
            const avatar = document.createElement('img');
            avatar.className = 'light-account-skin-head';
            avatar.alt = `Cabeza de ${account.name || 'Minecraft'}`;
            avatar.src = `https://mc-heads.net/avatar/${encodeURIComponent(account.name || identity || 'Steve')}/96`;
            avatar.onerror = () => { avatar.onerror = null; avatar.src = 'https://mc-heads.net/avatar/Steve/96'; };
            const code = document.createElement('span');
            code.className = 'light-account-code';
            code.textContent = identity ? String(identity) : 'Sin UUID disponible';
            code.title = identity ? `UUID: ${identity}` : 'No se encontró UUID de Minecraft';
            avatarColumn.append(avatar);
            const info = document.createElement('div');
            info.className = 'light-account-info';
            const name = document.createElement('strong');
            name.textContent = account.name || 'Cuenta Microsoft';
            const actions = document.createElement('div');
            actions.className = 'light-account-row-actions';
            const select = document.createElement('button');
            select.type = 'button';
            select.className = 'btn-secondary';
            select.textContent = active ? 'Seleccionada' : 'Seleccionar';
            select.disabled = active;
            select.dataset.accountAction = 'select';
            select.dataset.accountId = account.ID;
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'light-remove-account';
            remove.textContent = 'Salir';
            remove.dataset.accountAction = 'remove';
            remove.dataset.accountId = account.ID;
            actions.append(select, remove);
            info.append(name, actions);
            card.append(avatarColumn, info, code);
            list.append(card);
        }
    }
    async setInstance(auth) {
        let configClient = await this.db.readData('configClient') || {};
        let instanceSelect = configClient.instance_selct;
        let instancesList = await config.getInstanceList();
        for (let instance of instancesList) {
            if (instance.whitelistActive) {
                let whitelist = (instance.whitelist || []).find(whitelist => whitelist == auth.name);
                if (whitelist !== auth.name) {
                    if (instance.name == instanceSelect) {
                        let newInstanceSelect = instancesList.find(i => i.whitelistActive == false);
                        if (newInstanceSelect) {
                            configClient.instance_selct = newInstanceSelect.name;
                            await setStatus(newInstanceSelect.status);
                        }
                    }
                }
            }
        }
        return configClient;
    }
    async ram() {
        const slider = document.getElementById('light-ram-range');
        const value = document.getElementById('light-ram-value');
        const number = document.getElementById('light-ram-number');
        const toggle = document.getElementById('light-ram-toggle');
        const ticks = document.getElementById('light-ram-ticks');
        const minLabel = document.getElementById('light-ram-min-label');
        const maxLabel = document.getElementById('light-ram-max-label');
        const save = document.getElementById('light-ram-save');
        const feedback = document.getElementById('light-ram-feedback');
        const recommendation = document.getElementById('light-ram-recommendation');
        const totalLabel = document.getElementById('total-ram');
        const freeLabel = document.getElementById('free-ram');
        if (!slider || !save || !feedback)
            return;
        const totalGB = os.totalmem() / (1024 ** 3);
        const minMB = 512;
        const stepMB = 32;
        const maxMB = Math.max(minMB, Math.floor(totalGB * 1024 / stepMB) * stepMB);
        const clamp = mb => Math.max(minMB, Math.min(maxMB, Math.round(mb / stepMB) * stepMB));
        slider.min = String(minMB);
        slider.max = String(maxMB);
        slider.step = String(stepMB);
        if (number) {
            number.min = String(minMB);
            number.max = String(maxMB);
            number.step = String(stepMB);
        }
        if (minLabel)
            minLabel.textContent = `${minMB} MB`;
        if (maxLabel)
            maxLabel.textContent = `${totalGB.toFixed(1)} GB`;
        const ensureRamTicks = () => {
            if (!ticks)
                return;
            const count = Math.min(6, Math.max(2, Math.floor((maxMB - minMB) / stepMB) + 1));
            if (ticks.children.length === count)
                return;
            ticks.replaceChildren();
            for (let i = 0; i < count; i++) {
                const mark = document.createElement('span');
                mark.style.left = `${i / (count - 1) * 100}%`;
                ticks.appendChild(mark);
            }
        };
        ensureRamTicks();
        if (totalLabel)
            totalLabel.textContent = `${totalGB.toFixed(1)} GB`;
        const refreshFree = () => {
            if (freeLabel)
                freeLabel.textContent = `${(os.freemem() / (1024 ** 3)).toFixed(1)} GB`;
        };
        refreshFree();
        const current = await this.db.readData('configClient') || {};
        const savedGB = Number(current.java_config?.java_memory?.max);
        const initialMB = Number.isFinite(savedGB) && savedGB > 0 ? savedGB * 1024 : 2048;
        slider.value = String(clamp(initialMB));
        if (toggle)
            toggle.checked = true;
        const updateLabel = () => {
            ensureRamTicks();
            const chosenMB = Number(slider.value);
            if (value)
                value.textContent = `${chosenMB} MB`;
            if (number && document.activeElement !== number)
                number.value = String(chosenMB);
            const progress = maxMB === minMB ? 100 : (chosenMB - minMB) / (maxMB - minMB) * 100;
            slider.parentElement.style.setProperty('--ram-progress', `${progress}%`);
            if (ticks) {
                ticks.querySelectorAll('span').forEach((mark, index, marks) => {
                    const markProgress = marks.length <= 1 ? 0 : index / (marks.length - 1) * 100;
                    mark.classList.toggle('light-ram-tick-active', markProgress <= progress + 0.001);
                    const distancePx = Math.abs(markProgress - progress) / 100 * Math.max(0, ticks.clientWidth);
                    mark.classList.toggle('light-ram-tick-under-thumb', distancePx < 10);
                });
            }
            if (recommendation) {
                const remainingGB = totalGB - chosenMB / 1024;
                recommendation.textContent = remainingGB < 2
                    ? '⚠️ Esta asignación deja menos de 2 GB para Windows y otras aplicaciones.'
                    : '';
            }
        };
        slider.addEventListener('input', updateLabel);
        if (number)
            number.addEventListener('change', () => {
                const raw = Number(number.value);
                slider.value = String(clamp(Number.isFinite(raw) ? raw : minMB));
                number.value = slider.value;
                updateLabel();
            });
        if (toggle)
            toggle.addEventListener('change', () => {
                slider.disabled = !toggle.checked;
                if (number)
                    number.disabled = !toggle.checked;
                save.disabled = !toggle.checked;
                slider.closest('.light-modrinth-ram')?.classList.toggle('light-ram-disabled', !toggle.checked);
                feedback.textContent = toggle.checked ? '' : 'Activa la edición para cambiar la RAM. La configuración guardada no cambia.';
            });
        updateLabel();
        save.onclick = async () => {
            const chosenMB = Number(slider.value);
            if (!Number.isFinite(chosenMB) || chosenMB < minMB || chosenMB > maxMB) {
                feedback.textContent = 'Selecciona una cantidad de RAM válida.';
                return;
            }
            try {
                const data = await this.db.readData('configClient') || {};
                data.java_config ||= {};
                const max = chosenMB / 1024;
                const min = Math.min(1, max);
                data.java_config.java_memory = { min, max };
                await this.db.updateData('configClient', data);
                refreshFree();
                feedback.textContent = `Guardado: ${chosenMB} MB para Minecraft. Se aplicará en el próximo inicio del juego.`;
                notify(`RAM guardada: ${chosenMB} MB`, 'success');
            }
            catch (err) {
                console.error('Error guardando RAM:', err);
                feedback.textContent = 'No se pudo guardar la RAM. Revisa la consola.';
                notify('No se pudo guardar la RAM.', 'error');
            }
        };
    }
    async javaPath() {
        let javaPathText = document.querySelector(".java-path-txt");
        javaPathText.textContent = `${await appdata()}/${process.platform == 'darwin' ? this.config.dataDirectory : `.${this.config.dataDirectory}`}/runtime`;
        let configClient = await this.db.readData('configClient');
        let javaPath = configClient?.java_config?.java_path || 'Usar la versión de java incluida con el launcher';
        let javaPathInputTxt = document.querySelector(".java-path-input-text");
        let javaPathInputFile = document.querySelector(".java-path-input-file");
        javaPathInputTxt.value = javaPath;
        document.querySelector(".java-path-set").addEventListener("click", async () => {
            javaPathInputFile.value = '';
            javaPathInputFile.click();
            await new Promise((resolve) => {
                let interval;
                interval = setInterval(() => {
                    if (javaPathInputFile.value != '')
                        resolve(clearInterval(interval));
                }, 100);
            });
            if (javaPathInputFile.value.replace(".exe", '').endsWith("java") || javaPathInputFile.value.replace(".exe", '').endsWith("javaw")) {
                let configClient = await this.db.readData('configClient');
                let file = javaPathInputFile.files[0].path;
                javaPathInputTxt.value = file;
                configClient.java_config.java_path = file;
                await this.db.updateData('configClient', configClient);
            }
            else
                alert("El nombre del archivo debe ser java o javaw");
        });
        document.querySelector(".java-path-reset").addEventListener("click", async () => {
            let configClient = await this.db.readData('configClient');
            javaPathInputTxt.value = 'Usar la versión de java incluida con el launcher';
            configClient.java_config.java_path = null;
            await this.db.updateData('configClient', configClient);
        });
    }
    async launcher() {
        let configClient = await this.db.readData('configClient');
        let closeBox = document.querySelector(".close-box");
        let closeLauncher = configClient?.launcher_config?.closeLauncher || "close-launcher";
        if (closeLauncher == "close-launcher") {
            document.querySelector('.close-launcher').classList.add('active-close');
        }
        else if (closeLauncher == "close-all") {
            document.querySelector('.close-all').classList.add('active-close');
        }
        else if (closeLauncher == "close-none") {
            document.querySelector('.close-none').classList.add('active-close');
        }
        closeBox.addEventListener("click", async (e) => {
            if (e.target.classList.contains('close-btn')) {
                let activeClose = document.querySelector('.active-close');
                if (e.target.classList.contains('active-close'))
                    return;
                activeClose?.classList.toggle('active-close');
                let configClient = await this.db.readData('configClient');
                if (e.target.classList.contains('close-launcher')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-launcher";
                    await this.db.updateData('configClient', configClient);
                }
                else if (e.target.classList.contains('close-all')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-all";
                    await this.db.updateData('configClient', configClient);
                }
                else if (e.target.classList.contains('close-none')) {
                    e.target.classList.toggle('active-close');
                    configClient.launcher_config.closeLauncher = "close-none";
                    await this.db.updateData('configClient', configClient);
                }
            }
        });
    }
    async profileSummary() {
        try {
            const cfg = await this.db.readData('configClient') || {};
            const account = await this.db.readData('accounts', cfg.account_selected);
            const name = document.getElementById('light-profile-name');
            if (name)
                name.textContent = account?.name || 'Sin cuenta seleccionada';
            const type = document.getElementById('light-profile-type');
            if (type)
                type.textContent = account ? 'Minecraft · Microsoft · Cuenta activa' : 'Añade una cuenta Microsoft para jugar';
            const avatar = document.getElementById('light-profile-avatar');
            if (avatar)
                avatar.textContent = (account?.name || 'M').slice(0, 1).toUpperCase();
        }
        catch (err) {
            console.warn('Perfil:', err);
        }
    }
    async premiumAccount() {
        const cfg = await this.db.readData('configClient') || {};
        return this.db.readData('accounts', cfg.account_selected);
    }
    async premiumRequest(action, payload = {}) {
        const account = await this.premiumAccount();
        const token = account?.access_token || account?.accessToken || account?.minecraft?.access_token || account?.minecraft?.accessToken;
        if (!token || typeof token !== 'string')
            throw new Error('La cuenta seleccionada no tiene una sesión de Minecraft válida. Vuelve a iniciar sesión con Microsoft.');
        return ipcRenderer.invoke('light-minecraft-profile', { action, token, ...payload });
    }
    async refreshSkinPlayerName() {
        const label = document.getElementById('light-preview-player-name');
        if (!label)
            return;
        try {
            const account = await this.premiumAccount();
            label.textContent = account?.name || account?.profile?.name || 'Jugador';
        }
        catch (error) {
            console.warn('No se pudo actualizar el nombre de Skins:', error);
        }
    }
    appearancePanel() {
        const file = document.getElementById('light-skin-file');
        const stage = document.getElementById('light-character-stage');
        const canvas = document.getElementById('light-skin-canvas');
        const status = document.getElementById('light-appearance-status');
        const model = document.getElementById('light-skin-model');
        const play = document.getElementById('light-animation-toggle');
        if (!file || !stage || !canvas || !status || !model)
            return;
        let skinview3d;
        try {
            skinview3d = require('skinview3d');
        }
        catch (err) {
            status.textContent = 'Falta instalar skinview3d. Ejecuta npm install skinview3d@3.4.2 en la carpeta del launcher y reinícialo.';
            console.error('skinview3d:', err);
            return;
        }
        const viewer = new skinview3d.SkinViewer({ canvas, width: 320, height: 440 });
        viewer.zoom = 0.85;
        viewer.fov = 70;
        viewer.camera.position.set(25, 6.9, 45);
        viewer.controls.target.set(0, 1.9, 0);
        viewer.camera.lookAt(0, 1.9, 0);
        viewer.controls.enableRotate = true;
        viewer.controls.enableZoom = true;
        viewer.controls.minDistance = 30;
        viewer.controls.maxDistance = 43;
        viewer.controls.enablePan = false;
        viewer.animation = null;
        let walking = false, selectedFile = null;
        let savedModel = 'classic', activeSkinBlob = null, loadingProfile = false;
        let skinObjectUrl = null, capeLoadSerial = 0;
        const updateCanvasSize = () => {
            const width = Math.max(180, Math.round(stage.clientWidth));
            const height = Math.max(240, Math.round(stage.clientHeight));
            viewer.setSize(width, height);
        };
        updateCanvasSize();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateCanvasSize) : null;
        observer?.observe(stage);
        const oldViewer = this._lightSkinViewer;
        if (oldViewer) {
            try {
                oldViewer.dispose();
            }
            catch (_) { }
        }
        this._lightSkinViewer = viewer;
        play?.addEventListener('click', () => {
            walking = !walking;
            viewer.animation = walking ? new skinview3d.WalkingAnimation() : null;
            play.textContent = walking ? '❚❚' : '▶';
            play.title = walking ? 'Pausar' : 'Reproducir';
            play.setAttribute('aria-label', play.title);
            play.setAttribute('aria-pressed', String(walking));
        });
        void this.refreshSkinPlayerName();
        const loadSkinBlob = async (blob) => {
            if (!blob)
                return;
            const url = URL.createObjectURL(blob);
            try {
                await viewer.loadSkin(url, { model: model.value === 'slim' ? 'slim' : 'default' });
            }
            catch (err) {
                URL.revokeObjectURL(url);
                throw err;
            }
            if (skinObjectUrl)
                URL.revokeObjectURL(skinObjectUrl);
            skinObjectUrl = url;
        };
        const grid = document.getElementById('light-wardrobe-grid');
        const menu = document.getElementById('light-wardrobe-menu');
        document.body.appendChild(menu);
        const dialog = document.getElementById('light-capes-dialog');
        const capeGrid = document.getElementById('light-capes-grid');
        const capeStatus = document.getElementById('light-capes-status');
        let library = [], owner = '', chosen = '', deleteId = '', capes = [], activeCapeId = '', pendingCape = '';
        let busy = false;
        const accountKey = async () => { const a = await this.premiumAccount(); return String(a?.uuid || a?.id || a?.name || a?.ID || ''); };
        const dataURL = blob => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(blob); });
        const toBlob = async (url) => (await fetch(url)).blob();
        const store = next => { if (!owner)
            throw new Error('No hay cuenta seleccionada.'); localStorage.setItem('hexa-wardrobe:' + owner, JSON.stringify(next)); library = next; };
        const setModel = value => { model.value = value; document.querySelectorAll('#light-model-choices .light-choice').forEach(b => b.classList.toggle('active', b.dataset.model === value)); };
        const thumbnail = async (url, target) => { const img = new Image(); img.src = url; await img.decode(); const ctx = target.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64); ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64); };
        const renderLibrary = () => {
            menu.hidden = true;
            grid.replaceChildren();
            document.getElementById('light-wardrobe-count').textContent = `(${library.length}/5)`;
            const add = document.createElement('button');
            add.type = 'button';
            add.className = 'light-wardrobe-add';
            add.textContent = '+';
            add.title = 'Añadir skin';
            add.disabled = library.length >= 5 || !owner;
            add.onclick = () => { if (!busy && !loadingProfile)
                file.click(); };
            grid.append(add);
            for (const item of library) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'light-wardrobe-tile';
                btn.classList.toggle('active', item.id === chosen);
                btn.title = item.name;
                btn.setAttribute('aria-label', item.name);
                const thumb = document.createElement('canvas');
                thumb.width = thumb.height = 64;
                btn.append(thumb);
                void thumbnail(item.data, thumb).catch(console.warn);
                btn.onclick = async () => { if (busy || loadingProfile)
                    return; busy = true; try {
                    const blob = await toBlob(item.data);
                    setModel(item.model);
                    await loadSkinBlob(blob);
                    selectedFile = blob;
                    chosen = item.id;
                    renderLibrary();
                }
                catch (e) {
                    status.textContent = e.message;
                }
                finally {
                    busy = false;
                } };
                btn.oncontextmenu = e => {
                    e.preventDefault();
                    if (busy || loadingProfile)
                        return;
                    deleteId = item.id;
                    menu.style.left = "0px";
                    menu.style.top = "0px";
                    menu.hidden = false;
                    const rect = menu.getBoundingClientRect();
                    menu.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - rect.width - 8)) + 'px';
                    menu.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - rect.height - 8)) + 'px';
                };
                grid.append(btn);
            }
        };
        document.getElementById('light-wardrobe-delete').onclick = async () => { if (busy || loadingProfile)
            return; try {
            store(library.filter(x => x.id !== deleteId));
            if (chosen === deleteId) {
                chosen = '';
                selectedFile = null;
                setModel(savedModel);
                await loadSkinBlob(activeSkinBlob);
            }
            renderLibrary();
        }
        catch (e) {
            status.textContent = e.message;
        }
        finally {
            menu.hidden = true;
        } };
        document.addEventListener('click', e => { if (!menu.contains(e.target))
            menu.hidden = true; });
        document.addEventListener('keydown', e => { if (e.key === 'Escape')
            menu.hidden = true; });
        window.addEventListener('resize', () => { menu.hidden = true; });
        document.addEventListener('scroll', () => { menu.hidden = true; }, true);
        const capeTip = document.createElement('div');
        capeTip.className = 'light-cape-tooltip';
        capeTip.hidden = true;
        dialog.append(capeTip);
        const hideCapeTip = () => { capeTip.hidden = true; };
        const showCapeTip = btn => {
            capeTip.textContent = btn.dataset.capeTip;
            capeTip.hidden = false;
            const r = btn.getBoundingClientRect(), d = dialog.getBoundingClientRect(), t = capeTip.getBoundingClientRect();
            capeTip.style.left = Math.max(d.left + 6, Math.min(r.left + (r.width - t.width) / 2, d.right - t.width - 6)) + 'px';
            capeTip.style.top = (r.top - t.height - 5 >= d.top ? r.top - t.height - 5 : r.bottom + 5) + 'px';
        };
        capeGrid.addEventListener('scroll', hideCapeTip);
        dialog.addEventListener('close', hideCapeTip);
        const renderCapes = () => {
            hideCapeTip();
            capeGrid.replaceChildren();
            for (const cape of [{ id: '', alias: 'Sin capa' }, ...capes]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'light-cape-tile';
                btn.classList.toggle('active', cape.id === pendingCape);
                btn.dataset.capeTip = cape.alias || cape.name || 'Capa de Minecraft';
                btn.setAttribute('aria-label', btn.dataset.capeTip);
                if (cape.url) {
                    const cv = document.createElement('canvas');
                    cv.width = 40;
                    cv.height = 64;
                    btn.append(cv);
                    const img = new Image();
                    img.onload = () => { const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = false; const scale = img.width / 64; ctx.drawImage(img, scale, scale, 10 * scale, 16 * scale, 0, 0, 40, 64); };
                    img.src = cape.url;
                }
                else {
                    btn.classList.add('light-no-cape');
                    btn.innerHTML = `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#b8b8c2" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg><span>Sin capa</span>`;
                }
                btn.addEventListener('mouseenter', () => showCapeTip(btn));
                btn.addEventListener('mouseleave', hideCapeTip);
                btn.addEventListener('focus', () => showCapeTip(btn));
                btn.addEventListener('blur', hideCapeTip);
                btn.onclick = () => { pendingCape = cape.id; renderCapes(); };
                capeGrid.append(btn);
            }
        };
        document.getElementById('light-capes-open').onclick = async () => { if (busy || loadingProfile)
            return; dialog.showModal(); capeStatus.textContent = 'Cargando capas…'; capeGrid.replaceChildren(); const apply = document.getElementById('light-capes-apply'); apply.disabled = true; try {
            const profile = await this.premiumRequest('profile');
            capes = profile.capes || [];
            activeCapeId = capes.find(x => x.state === 'ACTIVE')?.id || '';
            pendingCape = activeCapeId;
            renderCapes();
            capeStatus.textContent = '';
            apply.disabled = false;
        }
        catch (e) {
            capeStatus.textContent = e.message;
        } };
        document.getElementById('light-capes-close').onclick = () => dialog.close();
        document.getElementById('light-capes-apply').onclick = async (e) => { if (busy)
            return; busy = true; const btn = e.currentTarget; btn.disabled = true; try {
            await this.premiumRequest('cape', { capeId: pendingCape });
            activeCapeId = pendingCape;
            await viewer.loadCape(capes.find(x => x.id === activeCapeId)?.url || null);
            dialog.close();
            notify('Capa actualizada correctamente.', 'success');
        }
        catch (err) {
            capeStatus.textContent = err.message;
        }
        finally {
            busy = false;
            btn.disabled = false;
        } };
        const displayActiveCape = async (profile) => {
            const activeCape = (profile.capes || []).find(c => c.state === 'ACTIVE');
            const serial = ++capeLoadSerial;
            try {
                await viewer.loadCape(activeCape?.url || null);
            }
            catch (err) {
                if (serial === capeLoadSerial)
                    console.warn('Vista previa de capa:', err);
            }
        };
        document.getElementById('light-model-choices')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-model]');
            if (!btn)
                return;
            model.value = btn.dataset.model;
            document.querySelectorAll('#light-model-choices .light-choice').forEach(b => b.classList.toggle('active', b === btn));
            if (selectedFile || activeSkinBlob) {
                try {
                    await loadSkinBlob(selectedFile || activeSkinBlob);
                }
                catch (err) {
                    status.textContent = 'No se pudo mostrar el modelo: ' + err.message;
                }
            }
        });
        file.addEventListener('change', async () => {
            const candidate = file.files?.[0] || null;
            file.value = '';
            if (busy || loadingProfile || !owner || library.length >= 5)
                return;
            const fileName = document.getElementById('light-file-name');
            if (fileName)
                fileName.textContent = candidate?.name || 'Ningún archivo seleccionado';
            if (!candidate)
                return;
            if (candidate.type !== 'image/png' || candidate.size > 2 * 1024 * 1024) {
                status.textContent = 'Elige un PNG de hasta 2 MB.';
                return;
            }
            const img = new Image(), url = URL.createObjectURL(candidate);
            try {
                await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
                if (img.width !== 64 || ![32, 64].includes(img.height))
                    throw new Error('La skin debe medir 64×64 o 64×32 píxeles.');
                const data = await dataURL(candidate);
                if (library.some(x => x.data === data))
                    throw new Error('Esta skin ya está guardada.');
                const item = { id: Date.now().toString(36), name: candidate.name, data, model: model.value };
                store([...library, item]);
                chosen = item.id;
                renderLibrary();
                await loadSkinBlob(candidate);
                selectedFile = candidate;
                status.textContent = '';
            }
            catch (err) {
                status.textContent = err.message || 'No se pudo abrir la skin.';
            }
            finally {
                URL.revokeObjectURL(url);
            }
        });
        const refresh = async () => {
            if (loadingProfile || busy)
                return;
            status.textContent = '';
            loadingProfile = true;
            try {
                const key = await accountKey();
                if (key !== owner) {
                    owner = key;
                    selectedFile = null;
                    activeSkinBlob = null;
                    chosen = '';
                    library = [];
                    try {
                        library = JSON.parse(localStorage.getItem('hexa-wardrobe:' + owner) || '[]').slice(0, 5);
                    }
                    catch (_) { }
                }
                renderLibrary();
                const profile = await this.premiumRequest('profile');
                await displayActiveCape(profile);
                const skin = profile.skins?.find(s => s.state === 'ACTIVE') || profile.skins?.[0];
                if (skin) {
                    savedModel = String(skin.variant || 'classic').toLowerCase() === 'slim' ? 'slim' : 'classic';
                    if (!selectedFile) {
                        model.value = savedModel;
                        document.querySelectorAll('#light-model-choices .light-choice').forEach(b => b.classList.toggle('active', b.dataset.model === savedModel));
                    }
                }
                if (skin?.url) {
                    try {
                        const response = await fetch(skin.url);
                        if (!response.ok)
                            throw new Error('No se pudo descargar la skin');
                        activeSkinBlob = await response.blob();
                        try {
                            const account = await this.premiumAccount();
                            const accountKey = String(account?.uuid || account?.id || account?.name || account?.ID || '');
                            const reader = new FileReader();
                            reader.onload = () => {
                                if (accountKey && typeof reader.result === 'string')
                                    window.dispatchEvent(new CustomEvent('light-skin-updated', {
                                        detail: { accountKey, skinDataUrl: reader.result }
                                    }));
                            };
                            reader.readAsDataURL(activeSkinBlob);
                        }
                        catch (error) {
                            console.warn('Sincronización skin 2D:', error);
                        }
                        if (!selectedFile)
                            await loadSkinBlob(activeSkinBlob);
                    }
                    catch (err) {
                        console.warn('Skin:', err);
                    }
                }
                status.textContent = '';
            }
            catch (err) {
                status.textContent = err.message || String(err);
            }
            finally {
                loadingProfile = false;
            }
        };
        document.getElementById('light-appearance-save')?.addEventListener('click', async (e) => {
            if (loadingProfile) {
                status.textContent = 'Espera a que termine de cargar tu perfil.';
                return;
            }
            const save = e.currentTarget;
            const updateSkin = Boolean(selectedFile) || model.value !== savedModel;
            if (!updateSkin) {
                status.textContent = 'No hay cambios pendientes.';
                return;
            }
            const skinBlob = selectedFile || activeSkinBlob;
            if (updateSkin && !skinBlob) {
                status.textContent = 'Selecciona un PNG para guardar ese modelo.';
                return;
            }
            save.disabled = true;
            status.textContent = 'Guardando cambios…';
            const completed = [];
            try {
                if (updateSkin) {
                    const bytes = Array.from(new Uint8Array(await skinBlob.arrayBuffer()));
                    await this.premiumRequest('skin', { bytes, variant: model.value });
                    try {
                        const account = await this.premiumAccount();
                        const accountKey = String(account?.uuid || account?.id || account?.name || account?.ID || '');
                        const reader = new FileReader();
                        reader.onload = () => {
                            if (accountKey && typeof reader.result === 'string')
                                window.dispatchEvent(new CustomEvent('light-skin-updated', {
                                    detail: { accountKey, skinDataUrl: reader.result }
                                }));
                        };
                        reader.readAsDataURL(skinBlob);
                    }
                    catch (error) {
                        console.warn('Vista previa 2D:', error);
                    }
                    savedModel = model.value;
                    activeSkinBlob = skinBlob;
                    selectedFile = null;
                    if (chosen) {
                        try {
                            store(library.map(x => x.id === chosen ? { ...x, model: savedModel } : x));
                        }
                        catch (err) {
                            console.warn(err);
                        }
                    }
                    completed.push('skin y modelo');
                }
                status.textContent = 'Cambios guardados correctamente.';
                notify('Skin y modelo guardados correctamente.', 'success');
            }
            catch (err) {
                status.textContent = (completed.length ? 'Se guardó ' + completed.join(' y ') + ', pero hubo un error con el resto: ' : 'No se pudieron guardar los cambios: ') + (err.message || String(err));
            }
            finally {
                save.disabled = false;
            }
        });
        document.getElementById('appearance')?.addEventListener('click', refresh);
        window.addEventListener('light-accounts-changed-selection', () => { dialog.close(); void refresh(); });
    }
    newsPanel() {
        document.getElementById('light-news-refresh')?.addEventListener('click', () => this.loadNews());
    }
    async loadNews() {
        const list = document.querySelector('.light-news-list');
        const status = document.getElementById('light-news-status');
        if (!list || !status)
            return;
        if (this.newsLoading)
            return;
        this.newsLoading = true;
        status.classList.remove('light-news-empty');
        status.textContent = 'Cargando noticias...';
        list.replaceChildren();
        try {
            const result = await checkNewsNotifications();
            if (!result)
                throw new Error('Sin respuesta del webhost');
            markNewsAsRead(result);
            if (result && !Array.isArray(result) && result.enabled === false) {
                status.classList.add('light-news-empty');
                status.textContent = 'No hay noticias disponibles por el momento.';
                return;
            }
            const news = (Array.isArray(result) ? result : (Array.isArray(result?.news) ? result.news : [])).filter(item => item && typeof item === 'object' && item.enabled !== false);
            status.classList.toggle('light-news-empty', news.length === 0);
            status.textContent = news.length ? '' : 'No hay noticias disponibles por el momento.';
            for (const item of news) {
                if (!item || typeof item !== 'object')
                    continue;
                const card = document.createElement('article');
                card.className = 'light-news-card';
                const images = Array.isArray(item.images) ? item.images : (item.image ? [item.image] : []);
                const safeImages = images.filter(value => {
                    if (typeof value !== 'string')
                        return false;
                    try {
                        return ['https:', 'http:'].includes(new URL(value).protocol);
                    }
                    catch {
                        return false;
                    }
                });
                if (safeImages.length) {
                    let index = 0;
                    const gallery = document.createElement('div');
                    gallery.className = 'light-news-gallery';
                    const imageFrame = document.createElement('div');
                    imageFrame.className = 'light-news-image-frame';
                    const image = document.createElement('img');
                    image.loading = 'lazy';
                    image.referrerPolicy = 'no-referrer';
                    const corner = document.createElement('span');
                    corner.className = 'light-news-corner-title';
                    corner.textContent = String(item.image_title || item.banner_title || item.tag || 'LIGHT CLIENT');
                    imageFrame.append(image, corner);
                    const show = () => {
                        imageFrame.style.setProperty('--light-news-backdrop', `url("${safeImages[index].replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`);
                        image.src = safeImages[index];
                        image.alt = `${String(item.title || 'Noticia')} - imagen ${index + 1} de ${safeImages.length}`;
                        if (counter)
                            counter.textContent = `${index + 1} / ${safeImages.length}`;
                    };
                    let counter = null;
                    gallery.append(imageFrame);
                    if (safeImages.length > 1) {
                        const nav = document.createElement('div');
                        nav.className = 'light-news-gallery-nav';
                        const previous = document.createElement('button');
                        previous.type = 'button';
                        previous.textContent = '‹';
                        previous.setAttribute('aria-label', 'Imagen anterior');
                        counter = document.createElement('span');
                        counter.className = 'light-news-image-count';
                        const next = document.createElement('button');
                        next.type = 'button';
                        next.textContent = '›';
                        next.setAttribute('aria-label', 'Imagen siguiente');
                        previous.addEventListener('click', () => { index = (index - 1 + safeImages.length) % safeImages.length; show(); });
                        next.addEventListener('click', () => { index = (index + 1) % safeImages.length; show(); });
                        nav.append(previous, counter, next);
                        gallery.append(nav);
                    }
                    show();
                    card.append(gallery);
                }
                const body = document.createElement('div');
                body.className = 'light-news-body';
                const heading = document.createElement('h3');
                heading.textContent = String(item.title || 'Noticia de Light Studio');
                const content = document.createElement('p');
                content.className = 'light-news-text';
                content.textContent = String(item.description || item.content || '');
                const meta = document.createElement('div');
                meta.className = 'light-news-meta';
                const date = new Date(item.publish_date || item.date || '');
                meta.textContent = [item.author || 'Light Studio', Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-ES')].filter(Boolean).join(' · ');
                body.append(heading, content, meta);
                card.append(body);
                list.append(card);
            }
        }
        catch (error) {
            console.warn('Error cargando noticias:', error);
            status.textContent = 'No se pudieron cargar las noticias. Comprueba la conexión y la ruta news.json.';
        }
        finally {
            this.newsLoading = false;
        }
    }
}
export default Settings;

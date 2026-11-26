/**
 * @author DevAlex
 * @license CC-BY-NC 4.0
 */
import { inspectMods, removeBadMods, showIntegrityBlock } from '../utils/instance-integrity.js';
import { notify, syncToastPosition, setInstallProgress } from '../utils/toast.js';
import { checkAuthorization } from '../utils/authorization.js';
import { config, database, logger, changePanel, appdata, setStatus, pkg, popup } from '../utils.js';
import { checkNewsNotifications, refreshNewsBadges } from '../utils/news-notifications.js';
const { Launch } = require('minecraft-java-core');
const { shell, ipcRenderer } = require('electron');
class Home {
    static id = "home";
    async init(config) {
        this.config = config;
        this.db = new database();
        this.codeAccess = new Map();
        try {
            const saved = JSON.parse(localStorage.getItem('hexa-instance-code-access-v1') || '[]');
            this.codeAccess = new Map(saved.map(([name, entries]) => [name, new Map(entries)]));
        }
        catch (error) {
            console.warn('No se pudieron restaurar los accesos:', error);
        }
        try {
            this.forgottenInstances = JSON.parse(localStorage.getItem('hexa-forgotten-v1') || '{}');
        }
        catch (_) {
            this.forgottenInstances = {};
        }
        this.setupInstanceMedia();
        this.news();
        refreshNewsBadges();
        void checkNewsNotifications();
        if (!window.lightNewsCheckTimer)
            window.lightNewsCheckTimer = setInterval(() => { void checkNewsNotifications(); }, 5 * 60 * 1000);
        this.renderSidebarAvatars();
        this.instancesSelect();
        document.querySelector('.settings-btn')?.addEventListener('click', () => changePanel('settings'));
    }
    instanceCode(instance) {
        const code = instance.InstanceCode ?? instance.password;
        return typeof code === 'string' ? code.trim() : '';
    }
    whitelistAllows(instance, name) {
        return !instance.whitelistActive || (Boolean(name) &&
            Array.isArray(instance.whitelist) && instance.whitelist.some(user => String(user).toLowerCase() === String(name).toLowerCase()));
    }
    hasCodeAccess(instance, name) {
        const code = this.instanceCode(instance);
        if (!code)
            return true;
        return Boolean(name) && this.codeAccess?.get(String(name).toLowerCase())?.get(instance.name) === code;
    }
    isForgotten(instance, name) {
        return !instance.whitelistActive && !this.instanceCode(instance) && !!name && (this.forgottenInstances?.[name.toLowerCase()] || []).includes(instance.name);
    }
    async filterAuthorizedInstances(instancesList, authName) {
        return instancesList.filter(instance => this.whitelistAllows(instance, authName) &&
            this.hasCodeAccess(instance, authName) && !this.isForgotten(instance, authName));
    }
    setupInstanceMedia() {
        const home = document.getElementById('home-page');
        this.mediaHome = home;
        this.mediaAudio = new Audio();
        this.mediaAudio.loop = true;
        this.mediaVideo = home.querySelector('.light-instance-video');
        this.mediaVolume = 50;
        this.mediaMuted = true;
        this.mediaAnimated = true;
        try {
            const saved = JSON.parse(localStorage.getItem('hexa-media-v1') || '{}');
            this.mediaVolume = Math.max(1, Math.min(100, Number(saved.volume) || 50));
            this.mediaMuted = saved.muted !== false;
            this.mediaAnimated = saved.animated !== false;
        }
        catch (_) { }
        const slider = home.querySelector('.light-volume-popup input');
        slider.value = this.mediaVolume;
        const update = () => {
            home.querySelector('.light-volume-popup output').textContent = `${this.mediaVolume}%`;
            this.updateInstanceMedia();
            try {
                localStorage.setItem('hexa-media-v1', JSON.stringify({ volume: this.mediaVolume, muted: this.mediaMuted, animated: this.mediaAnimated }));
            }
            catch (_) { }
        };
        slider.addEventListener('input', () => {
            if ((!this.mediaAnimated && this.mediaImageUrl) || !this.mediaVideoUrl) {
                slider.value = this.mediaVolume;
                notify('No se puede reproducir', 'warning');
                return;
            }
            this.mediaVolume = Number(slider.value);
            this.mediaMuted = false;
            update();
        });
        home.querySelector('.light-sound').addEventListener('click', () => {
            if (this.mediaDefaultBackground) {
                notify('Tonto no tienes ninguna instancia puesta Xd', 'warning');
                return;
            }
            if ((!this.mediaAnimated && this.mediaImageUrl) || !this.mediaVideoUrl) {
                notify('No se puede reproducir', 'warning');
                return;
            }
            this.mediaMuted = !this.mediaMuted;
            update();
        });
        home.querySelector('.light-motion').addEventListener('click', () => {
            if (this.mediaDefaultBackground) {
                notify('Tonto no tienes ninguna instancia puesta Xd', 'warning');
                return;
            }
            const animated = (this.mediaAnimated || !this.mediaImageUrl) && !!this.mediaVideoUrl;
            if (!animated && !this.mediaVideoUrl) {
                notify('No hay animación disponible para esta instancia.', 'warning');
                return;
            }
            if (animated && !this.mediaImageUrl) {
                notify('No hay fondo de imagen disponible para esta instancia.', 'warning');
                return;
            }
            this.mediaAnimated = !animated;
            update();
        });
        const observer = new MutationObserver(() => this.updateInstanceMedia());
        observer.observe(home, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        this.mediaVideo.addEventListener('error', () => { this.mediaVideo.hidden = true; this.mediaAudio.pause(); });
        for (const event of ['playing', 'pause', 'waiting', 'seeking', 'seeked', 'timeupdate', 'ended']) {
            this.mediaVideo.addEventListener(event, () => {
                if (event === 'waiting' || event === 'seeking' || event === 'pause')
                    this.mediaAudio.pause();
                else
                    this.syncInstanceAudio(event !== 'timeupdate');
            });
        }
        this.mediaAudio.addEventListener('loadedmetadata', () => this.syncInstanceAudio(true));
        update();
    }
    updateInstanceMedia() {
        const home = this.mediaHome;
        if (!home)
            return;
        const visible = home.getClientRects().length > 0 && getComputedStyle(home).visibility !== 'hidden';
        const sound = home.querySelector('.light-sound');
        const motion = home.querySelector('.light-motion');
        sound.disabled = !this.mediaDefaultBackground && !this.mediaMusicUrl;
        motion.disabled = false;
        home.querySelector('.light-volume-popup').style.display = (this.mediaAnimated || !this.mediaImageUrl) && this.mediaVideoUrl && this.mediaMusicUrl ? '' : 'none';
        sound.setAttribute('aria-pressed', String((this.mediaAnimated || !this.mediaImageUrl) && !!this.mediaVideoUrl && !this.mediaMuted && !!this.mediaMusicUrl));
        motion.setAttribute('aria-pressed', String((this.mediaAnimated || !this.mediaImageUrl) && !!this.mediaVideoUrl));
        this.mediaAudio.volume = this.mediaVolume / 100;
        const animate = visible && (this.mediaAnimated || !this.mediaImageUrl) && !!this.mediaVideoUrl;
        this.mediaVideo.hidden = !animate;
        if (animate)
            this.mediaVideo.play().catch(() => { this.mediaVideo.hidden = true; this.mediaAudio.pause(); });
        else
            this.mediaVideo.pause();
        this.syncInstanceAudio(true);
    }
    syncInstanceAudio(force = false) {
        const video = this.mediaVideo;
        const audio = this.mediaAudio;
        if ((!this.mediaAnimated && this.mediaImageUrl) || !this.mediaVideoUrl || !this.mediaMusicUrl || this.mediaMuted ||
            video.hidden || video.paused || video.seeking || video.readyState < 3 || video.error) {
            audio.pause();
            return;
        }
        if (!Number.isFinite(audio.duration) || audio.duration <= 0)
            return;
        const target = video.currentTime % audio.duration;
        if (force || Math.abs(audio.currentTime - target) > 0.25) {
            if (Math.abs(audio.currentTime - target) > 0.04)
                audio.currentTime = target;
        }
        if (audio.paused)
            audio.play().catch(() => { });
    }
    setBackground(instance) {
        if (!this.mediaHome)
            return;
        const mediaUrl = (...values) => values.find(value => typeof value === 'string' && value.trim())?.trim() || '';
        this.mediaImageUrl = mediaUrl(instance?.backgroundUrl, instance?.background);
        const image = this.mediaImageUrl || 'assets/images/fondo.png';
        const music = mediaUrl(instance?.musicUrl, instance?.music);
        this.mediaDefaultBackground = !instance;
        const video = mediaUrl(instance?.animatedBackgroundUrl, instance?.animatedBackground);
        if (image !== this.currentBackground) {
            this.mediaHome.querySelector('.light-instance-background').style.backgroundImage = image ? `url(${JSON.stringify(image)})` : '';
            this.currentBackground = image;
        }
        if (music !== this.mediaMusicUrl || video !== this.mediaVideoUrl) {
            this.mediaAudio.pause();
            this.mediaVideo.pause();
            this.mediaAudio.currentTime = 0;
            this.mediaVideo.currentTime = 0;
        }
        for (const [element, key, url] of [[this.mediaAudio, 'mediaMusicUrl', music], [this.mediaVideo, 'mediaVideoUrl', video]]) {
            if (this[key] === url)
                continue;
            element.pause();
            this[key] = url;
            if (url)
                element.src = url;
            else
                element.removeAttribute('src');
            element.load();
        }
        this.updateInstanceMedia();
    }
    async news() {
        const newsElement = document.querySelector('.news-list');
        if (!newsElement)
            return;
        let news = false;
        try {
            news = await config.getNews();
        }
        catch (error) {
            console.warn('Error cargando noticias:', error);
        }
        newsElement.innerHTML = '';
        if (!news || !news.length) {
            const blockNews = document.createElement('div');
            blockNews.className = 'news-block';
            blockNews.innerHTML = `
                <div class="news-header">
                    <img class="server-status-icon"
                         src="assets/images/icon.png">
                    <div class="header-text">
                        <div class="title">
                            No hay noticias disponibles actualmente.
                        </div>
                    </div>
                    <div class="date">
                        <div class="day">25</div>
                        <div class="month">Abril</div>
                    </div>
                </div>
                <div class="news-content">
                    <div class="bbWrapper">
                        <p>
                            Puedes seguir todas las novedades
                            relativas al servidor aquí.
                        </p>
                    </div>
                </div>
            `;
            newsElement.appendChild(blockNews);
            return;
        }
        for (const item of news) {
            const date = this.getdate(item.publish_date);
            const blockNews = document.createElement('div');
            blockNews.className = 'news-block';
            blockNews.innerHTML = `
                <div class="news-header">
                    <img class="server-status-icon"
                         src="assets/images/icon.png">
                    <div class="header-text">
                        <div class="title">${item.title}</div>
                    </div>
                    <div class="date">
                        <div class="day">${date.day}</div>
                        <div class="month">${date.month}</div>
                    </div>
                </div>
                <div class="news-content">
                    <div class="bbWrapper">
                        <p>${item.content.replace(/\n/g, '<br>')}</p>
                        <p class="news-author">
                            - <span>${item.author}</span>
                        </p>
                    </div>
                </div>
            `;
            newsElement.appendChild(blockNews);
        }
    }
    socialLick() {
        document.querySelectorAll('.social-block').forEach(social => {
            social.addEventListener('click', () => {
                shell.openExternal(social.dataset.url);
            });
        });
    }
    async isCurrentInstance(name) {
        const current = await this.db.readData('configClient') || {};
        return current.instance_selct === name;
    }
    notifyInstanceSelectionBlocked() {
        notify(window.lightInstanceRunning
            ? 'No puedes cambiar de instancia mientras Minecraft está abierto.'
            : 'No puedes cambiar de instancia mientras Minecraft se está instalando.', 'warning');
    }
    async renderSidebarAvatars() {
        try {
            const configClient = await this.db.readData('configClient') || {};
            const auth = await this.db.readData('accounts', configClient.account_selected);
            const allInstances = await config.getInstanceList();
            const instancesList = await this.filterAuthorizedInstances(allInstances, auth?.name);
            const container = document.querySelector('.instance-avatars');
            if (!container)
                return;
            const sidebarState = JSON.stringify({
                account: auth?.name || '',
                instances: instancesList.map(instance => ({
                    name: instance.name,
                    avatar: instance.avatarUrl || instance.iconUrl || instance.icon || '',
                    background: instance.backgroundUrl || instance.background || ''
                }))
            });
            if (this._sidebarState === sidebarState &&
                container.children.length === instancesList.length &&
                [...container.children].every((el, i) => el.classList.contains('instance-avatar') &&
                    el.dataset.name === instancesList[i].name)) {
                container.querySelectorAll('.instance-avatar').forEach(el => {
                    el.classList.toggle('active', el.dataset.name === configClient.instance_selct);
                });
                return;
            }
            this._sidebarState = sidebarState;
            container.innerHTML = '';
            let tooltip = document.querySelector('.instance-tooltip');
            if (!tooltip) {
                tooltip = document.createElement('div');
                tooltip.className = 'instance-tooltip';
                tooltip.style.display = 'none';
                document.body.appendChild(tooltip);
            }
            const defaultAvatar = 'assets/images/instancias/logo.png';
            for (const instance of instancesList) {
                const bg = instance.backgroundUrl ||
                    instance.background ||
                    '';
                const avatar = instance.avatarUrl ||
                    instance.iconUrl ||
                    instance.icon ||
                    '';
                const el = document.createElement('div');
                el.className = 'instance-avatar';
                el.dataset.name = instance.name;
                el.style.backgroundImage =
                    `url('${avatar || bg || defaultAvatar}')`;
                if (configClient.instance_selct === instance.name) {
                    el.classList.add('active');
                }
                el.addEventListener('mouseenter', () => {
                    tooltip.textContent = instance.name;
                    tooltip.style.display = 'block';
                    const rect = el.getBoundingClientRect();
                    tooltip.style.top =
                        `${rect.top + rect.height / 2}px`;
                    tooltip.style.left =
                        `${rect.right + 10}px`;
                });
                el.addEventListener('mouseleave', () => {
                    tooltip.style.display = 'none';
                });
                el.addEventListener('click', async () => {
                    try {
                        if (await this.isCurrentInstance(instance.name)) {
                            notify('Esta instancia ya está seleccionada.', 'info');
                            return;
                        }
                        if (window.lightInstanceInstalling || window.lightInstanceRunning) {
                            this.notifyInstanceSelectionBlocked();
                            return;
                        }
                        const previous = container.querySelector('.instance-avatar.active');
                        if (window.lightInstanceInstalling || window.lightInstanceRunning) {
                            this.notifyInstanceSelectionBlocked();
                            return;
                        }
                        if (previous)
                            previous.classList.remove('active');
                        el.classList.add('active');
                        configClient.instance_selct = instance.name;
                        await this.db.updateData('configClient', configClient);
                        ipcRenderer.send('instance-changed', {
                            instanceName: instance.name
                        });
                        this.setBackground(instance);
                        setStatus(instance.status, instance.name);
                        notify(`Instancia seleccionada: ${instance.name}`, 'success');
                    }
                    catch (error) {
                        console.warn('Error seleccionando instancia:', error);
                    }
                });
                container.appendChild(el);
            }
        }
        catch (error) {
            console.warn('Error renderizando avatares:', error);
        }
    }
    async instancesSelect() {
        const configClient = await this.db.readData('configClient') || {};
        const auth = await this.db.readData('accounts', configClient.account_selected);
        const allInstances = await config.getInstanceList();
        let instancesList = await this.filterAuthorizedInstances(allInstances, auth?.name);
        let instanceSelect = instancesList.find(instance => instance.name === configClient.instance_selct)?.name || null;
        const playBTN = document.querySelector('.play-btn');
        const instanceBTN = document.querySelector('.instance-select');
        const instancePopup = document.querySelector('.instance-popup');
        const instancesListPopup = document.querySelector('.instances-List');
        const instanceCloseBTN = document.querySelector('.close-popup');
        const searchInput = document.querySelector('.instances-search');
        const codeInput = document.querySelector('.code-unlock-input');
        const unlockButton = document.querySelector('.code-unlock-button');
        const messageDiv = document.querySelector('.code-unlock-message');
        const codeToggleButton = document.querySelector('.instances-code-toggle');
        const codeSectionPanel = document.querySelector('.code-unlock-section');
        const codeCloseButton = document.querySelector('.code-unlock-close');
        if (instanceBTN) {
            instanceBTN.style.display = 'flex';
        }
        if (!instanceSelect && instancesList.length > 0) {
            instanceSelect = instancesList[0].name;
            configClient.instance_selct = instanceSelect;
            await this.db.updateData('configClient', configClient);
        }
        const selectedInstance = instancesList.find(instance => instance.name === instanceSelect);
        if (selectedInstance) {
            setStatus(selectedInstance.status, selectedInstance.name);
            this.setBackground(selectedInstance);
        }
        else {
            this.setBackground(null);
        }
        const refreshInstances = async () => {
            try {
                const currentConfig = await this.db.readData('configClient') || {};
                const currentAuth = await this.db.readData('accounts', currentConfig.account_selected);
                const latestInstances = await config.getInstanceList();
                instancesList =
                    await this.filterAuthorizedInstances(latestInstances, currentAuth?.name);
                const selectedIsAllowed = instancesList.some(instance => instance.name === currentConfig.instance_selct);
                if (!selectedIsAllowed) {
                    const fallback = instancesList[0] || null;
                    instanceSelect = fallback?.name || null;
                    currentConfig.instance_selct = instanceSelect;
                    await this.db.updateData('configClient', currentConfig);
                    if (fallback) {
                        setStatus(fallback.status, fallback.name);
                        this.setBackground(fallback);
                        ipcRenderer.send('instance-changed', {
                            instanceName: fallback.name
                        });
                    }
                    else {
                        setStatus(null, "Light Studio");
                        this.setBackground(null);
                    }
                }
                else {
                    instanceSelect = currentConfig.instance_selct;
                    this.setBackground(instancesList.find(item => item.name === instanceSelect));
                }
                await this.renderSidebarAvatars();
            }
            catch (error) {
                console.warn('Error actualizando instancias:', error);
            }
        };
        const toggleCodePanel = (show) => {
            if (!codeSectionPanel)
                return;
            codeSectionPanel.hidden = !show;
            if (show) {
                codeInput?.focus();
            }
        };
        let forgetMenu;
        const closeForgetMenu = () => { forgetMenu?.remove(); forgetMenu = null; };
        document.addEventListener('pointerdown', event => { if (forgetMenu && !forgetMenu.contains(event.target))
            closeForgetMenu(); });
        document.addEventListener('keydown', event => { if (event.key === 'Escape')
            closeForgetMenu(); });
        window.addEventListener('blur', closeForgetMenu);
        const closeSelector = () => {
            closeForgetMenu();
            if (instancePopup) {
                instancePopup.style.display = 'none';
                syncToastPosition();
            }
            toggleCodePanel(false);
        };
        const showCodeMessage = (message, color) => {
            if (!messageDiv)
                return;
            messageDiv.textContent = message;
            messageDiv.style.color = color;
        };
        toggleCodePanel(false);
        const renderInstanceCards = async () => {
            if (!instancesListPopup)
                return;
            const latestInstances = await config.getInstanceList();
            const currentConfig = await this.db.readData('configClient') || {};
            const account = await this.db.readData('accounts', currentConfig.account_selected);
            const allowedNames = new Set(latestInstances.filter(instance => this.whitelistAllows(instance, account?.name) && this.hasCodeAccess(instance, account?.name)).map(instance => instance.name));
            const search = (searchInput?.value || '').trim().toLowerCase();
            closeForgetMenu();
            instancesListPopup.replaceChildren();
            const filteredInstances = latestInstances.filter(instance => !this.isForgotten(instance, account?.name) && (!this.instanceCode(instance) || allowedNames.has(instance.name)) && String(instance.name || '')
                .toLowerCase()
                .includes(search));
            if (!filteredInstances.length) {
                const empty = document.createElement('div');
                empty.className = 'no-instances';
                empty.textContent =
                    'No se encontraron instancias disponibles.';
                instancesListPopup.appendChild(empty);
                return;
            }
            for (const instance of filteredInstances) {
                const allowed = allowedNames.has(instance.name);
                const bg = instance.backgroundUrl ||
                    instance.background ||
                    '';
                const avatar = instance.avatarUrl ||
                    instance.iconUrl ||
                    instance.icon ||
                    'assets/images/instancias/logo.png';
                const card = document.createElement('div');
                card.className = 'instance-card';
                card.tabIndex = 0;
                card.setAttribute('role', 'button');
                if (!allowed) {
                    card.classList.add('is-locked');
                }
                if (allowed && instance.name === instanceSelect) {
                    card.classList.add('active-instance');
                }
                const banner = document.createElement('div');
                banner.className = 'instance-banner';
                if (bg) {
                    banner.style.backgroundImage =
                        `url(${JSON.stringify(bg)})`;
                }
                const state = document.createElement('span');
                state.className = 'instance-state';
                state.textContent = allowed ? 'LISTA' : 'SIN ACCESO';
                const info = document.createElement('div');
                info.className = 'instance-card-info';
                const image = document.createElement('img');
                image.className = 'instance-card-icon';
                image.src = avatar;
                image.alt = '';
                image.onerror = () => {
                    image.onerror = null;
                    image.src = 'assets/images/instancias/logo.png';
                };
                const copy = document.createElement('div');
                copy.className = 'instance-card-copy';
                const name = document.createElement('div');
                name.className = 'instance-name';
                name.textContent = instance.name;
                const meta = document.createElement('div');
                meta.className = 'instance-meta';
                const version = instance.loadder?.minecraft_version ||
                    'Desconocida';
                const loader = instance.loadder?.loadder_type ||
                    'Vanilla';
                meta.textContent = `Minecraft ${version} · ${loader}`;
                copy.append(name, meta);
                info.append(image, copy);
                card.append(banner, state, info);
                const selectInstance = async () => {
                    if (await this.isCurrentInstance(instance.name)) {
                        notify('Esta instancia ya está seleccionada.', 'info');
                        return;
                    }
                    if (window.lightInstanceInstalling || window.lightInstanceRunning) {
                        this.notifyInstanceSelectionBlocked();
                        return;
                    }
                    if (!allowed) {
                        notify('No estás registrado en la whitelist de esta instancia.', 'warning');
                        return;
                    }
                    try {
                        await refreshInstances();
                        if (window.lightInstanceInstalling || window.lightInstanceRunning) {
                            this.notifyInstanceSelectionBlocked();
                            return;
                        }
                        if (!instancesList.some(item => item.name === instance.name)) {
                            notify('Ya no tienes acceso a esta instancia.', 'warning');
                            await renderInstanceCards();
                            return;
                        }
                        const currentConfig = await this.db.readData('configClient') || {};
                        if (window.lightInstanceInstalling || window.lightInstanceRunning) {
                            this.notifyInstanceSelectionBlocked();
                            return;
                        }
                        currentConfig.instance_selct = instance.name;
                        await this.db.updateData('configClient', currentConfig);
                        instanceSelect = instance.name;
                        ipcRenderer.send('instance-changed', {
                            instanceName: instance.name
                        });
                        setStatus(instance.status, instance.name);
                        this.setBackground(instance);
                        closeSelector();
                        await this.renderSidebarAvatars();
                        notify(`Instancia seleccionada: ${instance.name}`, 'success');
                    }
                    catch (error) {
                        console.error('Error seleccionando instancia:', error);
                    }
                };
                card.addEventListener('contextmenu', event => {
                    event.preventDefault();
                    closeForgetMenu();
                    if (!allowed || !account?.name || this.isForgotten(instance, account.name) || (instance.whitelistActive && !this.instanceCode(instance)))
                        return;
                    const menu = document.createElement('button');
                    forgetMenu = menu;
                    menu.type = 'button';
                    menu.textContent = 'Olvidar instancia';
                    Object.assign(menu.style, { position: 'fixed', zIndex: '2147483646', background: '#222226', color: '#ff5353', border: '1px solid #484848', padding: '12px 18px', cursor: 'pointer', font: 'inherit', borderRadius: '4px' });
                    document.body.appendChild(menu);
                    menu.style.left = Math.max(0, Math.min(event.clientX, innerWidth - menu.offsetWidth)) + 'px';
                    menu.style.top = Math.max(0, Math.min(event.clientY, innerHeight - menu.offsetHeight)) + 'px';
                    menu.addEventListener('click', async () => {
                        closeForgetMenu();
                        try {
                            const cfg = await this.db.readData('configClient') || {};
                            const user = await this.db.readData('accounts', cfg.account_selected);
                            const latest = (await config.getInstanceList()).find(item => item.name === instance.name);
                            if (!latest || !user?.name || user.name !== account.name || !this.whitelistAllows(latest, user.name) || !this.hasCodeAccess(latest, user.name) || (latest.whitelistActive && !this.instanceCode(latest)))
                                return;
                            if (window.lightInstanceInstalling || window.lightInstanceRunning) {
                                this.notifyInstanceSelectionBlocked();
                                return;
                            }
                            const key = user.name.toLowerCase();
                            if (this.instanceCode(latest)) {
                                this.codeAccess.get(key)?.delete(latest.name);
                                localStorage.setItem('hexa-instance-code-access-v1', JSON.stringify(Array.from(this.codeAccess, ([name, entries]) => [name, Array.from(entries)])));
                            }
                            else {
                                this.forgottenInstances[key] = [...new Set([...(this.forgottenInstances[key] || []), latest.name])];
                                localStorage.setItem('hexa-forgotten-v1', JSON.stringify(this.forgottenInstances));
                            }
                            await updateInstanceCards();
                            notify(`Instancia olvidada: ${latest.name}`, 'success');
                        }
                        catch (error) {
                            console.error(error);
                            notify('No se pudo olvidar la instancia.', 'error');
                        }
                    });
                });
                card.addEventListener('click', selectInstance);
                card.addEventListener('keydown', event => {
                    if (event.key === 'Enter' ||
                        event.key === ' ') {
                        event.preventDefault();
                        selectInstance();
                    }
                });
                instancesListPopup.appendChild(card);
            }
        };
        instanceBTN?.addEventListener('click', async () => {
            if (!instancePopup || !instancesListPopup)
                return;
            instancePopup.style.display = 'flex';
            syncToastPosition();
            if (searchInput) {
                searchInput.value = '';
            }
            toggleCodePanel(false);
            instancesListPopup.textContent =
                'Cargando instancias...';
            try {
                await refreshInstances();
                await renderInstanceCards();
            }
            catch (error) {
                console.error('Error cargando instancias:', error);
                instancesListPopup.textContent =
                    'No se pudieron cargar las instancias.';
            }
        });
        searchInput?.addEventListener('input', () => {
            renderInstanceCards().catch(error => {
                console.error('Error buscando instancias:', error);
            });
        });
        instanceCloseBTN?.addEventListener('click', closeSelector);
        instancePopup?.addEventListener('keydown', event => {
            if (event.key !== 'Escape')
                return;
            if (codeSectionPanel && !codeSectionPanel.hidden) {
                toggleCodePanel(false);
            }
            else {
                closeSelector();
            }
        });
        codeToggleButton?.addEventListener('click', () => {
            if (!codeSectionPanel)
                return;
            toggleCodePanel(codeSectionPanel.hidden);
        });
        codeCloseButton?.addEventListener('click', () => {
            toggleCodePanel(false);
        });
        const updateInstanceCards = async () => {
            await refreshInstances();
            await renderInstanceCards();
        };
        if (codeInput && unlockButton) {
            codeInput.addEventListener('keydown', event => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    unlockButton.click();
                }
            });
            unlockButton.addEventListener('click', async () => {
                if (unlockButton.disabled)
                    return;
                const codigo = codeInput.value.trim();
                showCodeMessage('', '');
                if (!codigo) {
                    notify('Introduce un código de acceso.', 'warning');
                    return;
                }
                unlockButton.disabled = true;
                unlockButton.textContent = 'VALIDANDO...';
                try {
                    const currentConfig = await this.db.readData('configClient') || {};
                    const cuenta = await this.db.readData('accounts', currentConfig.account_selected);
                    if (!cuenta?.name) {
                        notify('Selecciona una cuenta antes de canjear un código.', 'warning');
                        return;
                    }
                    const latest = await config.getInstanceList();
                    const matches = latest.filter(instance => this.instanceCode(instance) === codigo);
                    if (!matches.length) {
                        notify('Código incorrecto.', 'error');
                        return;
                    }
                    if (matches.length !== 1) {
                        notify('Código duplicado en la configuración del servidor.', 'error');
                        return;
                    }
                    const instance = matches[0];
                    if (!this.whitelistAllows(instance, cuenta.name)) {
                        notify('No estás registrado en la whitelist de esta instancia.', 'warning');
                        return;
                    }
                    if (this.hasCodeAccess(instance, cuenta.name)) {
                        notify('Ya tienes acceso a esta instancia.', 'info');
                        return;
                    }
                    this.codeAccess ??= new Map();
                    const key = cuenta.name.toLowerCase();
                    if (!this.codeAccess.has(key))
                        this.codeAccess.set(key, new Map());
                    this.codeAccess.get(key).set(instance.name, codigo);
                    try {
                        localStorage.setItem('hexa-instance-code-access-v1', JSON.stringify(Array.from(this.codeAccess, ([name, entries]) => [name, Array.from(entries)])));
                    }
                    catch (error) {
                        console.warn('No se pudieron guardar los accesos:', error);
                    }
                    codeInput.value = '';
                    toggleCodePanel(false);
                    await updateInstanceCards();
                    notify(`Instancia canjeada correctamente: ${instance.name}`, 'success');
                    window.dispatchEvent(new Event('instances-updated'));
                }
                catch (error) {
                    console.error('Error al canjear código:', error);
                    notify('Error al conectar con el servidor.', 'error');
                }
                finally {
                    unlockButton.disabled = false;
                    unlockButton.textContent = 'CANJEAR';
                }
            });
        }
        else {
            console.warn('No se encontraron los elementos para canjear códigos.');
        }
        setInterval(async () => {
            try {
                await refreshInstances();
            }
            catch (error) {
                console.warn('Error actualizando instancias:', error);
            }
        }, 2500);
        playBTN?.addEventListener('click', () => {
            if (this.integrityBusy)
                return;
            this.integrityBusy = true;
            this.startGame().catch(error => { console.error(error); notify('No se pudo verificar o iniciar la instancia.', 'error'); }).finally(() => { this.integrityBusy = false; });
        });
    }
    async startGame() {
        if (window.lightInstanceInstalling || window.lightInstanceRunning) {
            notify(window.lightInstanceRunning ? 'Minecraft ya está abierto.' : 'Minecraft ya se está iniciando.', 'warning');
            return;
        }
        if (!(await checkAuthorization()).allowed) {
            await changePanel('home');
            return;
        }
        const rawConfig = await this.db.readData('configClient');
        let configClient = rawConfig || {};
        let needPersist = false;
        if (!rawConfig || typeof rawConfig !== 'object') {
            needPersist = true;
            configClient = {
                account_selected: null,
                instance_selct: null,
                java_config: {
                    java_path: null,
                    java_memory: { min: 2, max: 4 }
                },
                game_config: {
                    screen_size: { width: 854, height: 480 }
                },
                launcher_config: {
                    download_multi: 5,
                    theme: 'auto',
                    closeLauncher: 'close-launcher',
                    intelEnabledMac: true
                }
            };
        }
        if (!configClient.launcher_config) {
            configClient.launcher_config = {
                download_multi: 5,
                theme: 'auto',
                closeLauncher: 'close-launcher',
                intelEnabledMac: true
            };
            needPersist = true;
        }
        if (!configClient.java_config) {
            configClient.java_config = {
                java_path: null,
                java_memory: { min: 2, max: 4 }
            };
            needPersist = true;
        }
        if (!configClient.java_config.java_memory) {
            configClient.java_config.java_memory = {
                min: 2,
                max: 4
            };
            needPersist = true;
        }
        if (!configClient.game_config) {
            configClient.game_config = {
                screen_size: { width: 854, height: 480 }
            };
            needPersist = true;
        }
        if (!configClient.game_config.screen_size) {
            configClient.game_config.screen_size = {
                width: 854,
                height: 480
            };
            needPersist = true;
        }
        if (needPersist) {
            try {
                await this.db.updateData('configClient', configClient);
            }
            catch (error) {
                console.warn('Error guardando configuración:', error);
            }
        }
        const authenticator = configClient.account_selected
            ? await this.db.readData('accounts', configClient.account_selected)
            : null;
        if (!authenticator || authenticator.error || !authenticator.name ||
            (authenticator.meta?.type === 'Xbox' && !authenticator.access_token)) {
            new popup().openPopup({
                title: 'Inicia sesión',
                content: 'Selecciona una cuenta Microsoft válida antes de jugar.',
                color: 'red',
                options: true
            });
            return;
        }
        const instances = await config.getInstanceList();
        const options = instances.find(instance => instance.name === configClient.instance_selct);
        const playInstanceBTN = document.querySelector('.play-instance');
        const infoStartingBOX = document.querySelector('.info-starting-game');
        if (!options) {
            new popup().openPopup({
                title: 'Error',
                content: 'No se encontró la instancia seleccionada.',
                color: 'red',
                options: true
            });
            return;
        }
        if (!authenticator) {
            new popup().openPopup({
                title: 'Error',
                content: 'No hay una cuenta seleccionada.',
                color: 'red',
                options: true
            });
            return;
        }
        const authorizedInstances = await this.filterAuthorizedInstances(instances, authenticator.name);
        if (!authorizedInstances.some(instance => instance.name === options.name)) {
            new popup().openPopup({
                title: 'Acceso denegado',
                content: `No tienes permiso para lanzar la instancia ${options.name}.`,
                color: 'red',
                options: true
            });
            return;
        }
        const opt = {
            url: options.url,
            authenticator,
            timeout: 10000,
            path: `${await appdata()}/${process.platform === 'darwin'
                ? this.config.dataDirectory
                : `.${this.config.dataDirectory}`}`,
            instance: options.name,
            version: options.loadder?.minecraft_version,
            detached: configClient.launcher_config.closeLauncher !==
                'close-all',
            downloadFileMultiple: configClient.launcher_config.download_multi,
            intelEnabledMac: configClient.launcher_config.intelEnabledMac,
            loader: {
                type: options.loadder?.loadder_type,
                build: options.loadder?.loadder_version,
                enable: options.loadder?.loadder_type !== 'none'
            },
            verify: options.verify,
            ignored: Array.isArray(options.ignored)
                ? [...options.ignored]
                : [],
            javaPath: configClient.java_config?.java_path,
            screen: {
                width: configClient.game_config.screen_size.width,
                height: configClient.game_config.screen_size.height
            },
            memory: {
                min: `${configClient.java_config.java_memory.min * 1024}M`,
                max: `${configClient.java_config.java_memory.max * 1024}M`
            }
        };
        if (options.protectedStorage === true) {
            const crypto = require('crypto');
            const path = require('path');
            const id = crypto.createHash('sha256').update(options.name, 'utf8').digest('hex').slice(0, 32);
            opt.path = path.join(opt.path, 'light-storage');
            opt.instance = id;
        }
        const strict = options.strictMods === true;
        let repairedMods = false;
        if (strict) {
            const result = await inspectMods(opt);
            const key = JSON.stringify([configClient.account_selected, result.root, result.fingerprint, result.bad.map(x => x.rel).sort()]);
            if (result.bad.length) {
                if (this.integrityConfirmation !== key) {
                    this.integrityConfirmation = key;
                    showIntegrityBlock();
                    return;
                }
                this.integrityConfirmation = null;
                await removeBadMods(result);
                repairedMods = true;
            }
            this.integrityConfirmation = null;
            opt.verify = false;
            opt.ignored = opt.ignored.filter(x => !/^mods(?:[\\/]|$)/i.test(x));
        }
        else
            this.integrityConfirmation = null;
        const launch = new Launch();
        if (strict) {
            const originalDownload = launch.DownloadGame.bind(launch);
            launch.DownloadGame = async () => {
                try {
                    const data = await originalDownload();
                    if (data.error)
                        return data;
                    const result = await inspectMods(opt);
                    if (result.bad.length || result.missing.length) {
                        showIntegrityBlock();
                        return { error: 'La verificación final de mods falló.' };
                    }
                    if (!(await checkAuthorization()).allowed)
                        return { error: 'Autorización revocada.' };
                    if (repairedMods)
                        notify('Verificación completada. Archivos no autorizados eliminados y mods restaurados.', 'success');
                    return data;
                }
                catch (error) {
                    return { error: String(error.message || error) };
                }
            };
        }
        window.lightInstanceInstalling = true;
        window.lightInstanceRunning = false;
        const currentPanel = document.querySelector('.panel.settings.active');
        if (currentPanel)
            notify('Instalando instancia…', 'info');
        const instanceName = options.name ||
            options.title ||
            opt.version?.name ||
            'Minecraft';
        const bar1 = document.getElementById('p-bar-1');
        const bar2 = document.getElementById('p-bar-2');
        const infoText = document.getElementById('info-text');
        const title = document.getElementById('display-title');
        const elapsedLabel = document.getElementById('loading-elapsed');
        const mainBox = document.getElementById('main-box');
        const loadingContainer = document.getElementById('loading-bars-container');
        const playingStatus = document.getElementById('playing-status');
        const startImg = document.getElementById('start-img');
        let loadingTimer = null;
        let playingTimeout = null;
        let finished = false;
        let playingTransitionStarted = false;
        let verificationStarted = false;
        let downloadedFiles = false;
        let openingNoticeTimer = null;
        const installStartedAt = Date.now();
        const installElapsed = () => {
            const s = Math.floor((Date.now() - installStartedAt) / 1000);
            return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        };
        const updateInstall = (status, percent) => setInstallProgress({
            name: instanceName, status, percent, elapsed: installElapsed()
        });
        const safeInstallUpdate = (status, percent) => {
            try {
                updateInstall(status, percent);
            }
            catch (err) {
                console.warn('Aviso de instalación:', err);
            }
        };
        const finishInstallNotice = () => {
            clearInterval(installClock);
            try {
                setInstallProgress(null);
            }
            catch (err) {
                console.warn('Cierre del aviso:', err);
            }
        };
        const installClock = setInterval(() => {
            if (!finished && !playingTransitionStarted) {
                try {
                    setInstallProgress({ elapsed: installElapsed() });
                }
                catch (err) {
                    console.warn('Contador del aviso:', err);
                }
            }
        }, 1000);
        safeInstallUpdate('Preparando instalación...', 0);
        const stopLoadingTimer = () => {
            if (loadingTimer !== null) {
                clearInterval(loadingTimer);
                loadingTimer = null;
            }
        };
        const startLoadingTimer = () => {
            stopLoadingTimer();
            const startTime = Date.now();
            const updateTime = () => {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const minutes = Math.floor(elapsed / 60);
                const seconds = elapsed % 60;
                if (elapsedLabel) {
                    elapsedLabel.textContent =
                        `${String(minutes).padStart(2, '0')}:` +
                            `${String(seconds).padStart(2, '0')}`;
                }
            };
            updateTime();
            loadingTimer = setInterval(updateTime, 1000);
        };
        const resetLoadingUI = () => {
            stopLoadingTimer();
            if (playingTimeout !== null) {
                clearTimeout(playingTimeout);
                playingTimeout = null;
            }
            if (infoStartingBOX) {
                infoStartingBOX.style.display = 'none';
            }
            if (playInstanceBTN) {
                playInstanceBTN.style.display = 'flex';
            }
            if (mainBox) {
                mainBox.classList.remove('is-playing');
            }
            if (loadingContainer) {
                loadingContainer.style.display = 'flex';
                loadingContainer.style.opacity = '1';
            }
            if (playingStatus) {
                playingStatus.style.display = 'none';
                playingStatus.style.opacity = '0';
            }
            if (bar1) {
                bar1.max = 100;
                bar1.value = 0;
            }
            if (bar2) {
                bar2.max = 100;
                bar2.value = 0;
            }
            if (infoText) {
                infoText.textContent = 'Conectando...';
            }
            ipcRenderer.send('main-window-progress-reset');
        };
        launch.on('progress', (progress, size) => {
            if (finished || playingTransitionStarted)
                return;
            downloadedFiles = true;
            const percentage = size > 0
                ? Math.min(100, Math.max(0, Math.round((progress / size) * 100)))
                : 0;
            safeInstallUpdate('Descargando archivos...', percentage);
            if (infoText) {
                infoText.textContent =
                    `Descargando... ${percentage}%`;
            }
            if (bar1) {
                bar1.max = size > 0 ? size : 1;
                bar1.value = size > 0
                    ? Math.min(Math.max(progress, 0), size)
                    : 0;
            }
        });
        launch.on('check', (progress, size) => {
            if (finished || playingTransitionStarted)
                return;
            verificationStarted = true;
            const percentage = size > 0
                ? Math.min(100, Math.max(0, Math.round((progress / size) * 100)))
                : 0;
            safeInstallUpdate('Verificando archivos...', percentage);
            if (infoText) {
                infoText.textContent =
                    `Verificando... ${percentage}%`;
            }
            if (bar2) {
                bar2.max = size > 0 ? size : 1;
                bar2.value = size > 0
                    ? Math.min(Math.max(progress, 0), size)
                    : 0;
            }
        });
        launch.on('estimated', time => {
            console.log(`Tiempo estimado: ${time}s`);
        });
        launch.on('speed', speed => {
            console.log(`${(speed / 1067008).toFixed(2)} Mb/s`);
        });
        launch.on('patch', () => {
            if (finished || playingTransitionStarted)
                return;
            safeInstallUpdate('Preparando Minecraft...', 100);
            if (verificationStarted && bar2) {
                bar2.value = bar2.max;
            }
            if (infoText) {
                infoText.textContent =
                    `Abriendo ${instanceName}...`;
            }
        });
        launch.on('data', () => {
            window.lightInstanceInstalling = false;
            window.lightInstanceRunning = true;
            if (finished || playingTransitionStarted)
                return;
            playingTransitionStarted = true;
            finishInstallNotice();
            stopLoadingTimer();
            if (title) {
                title.textContent = instanceName;
            }
            if (bar1) {
                bar1.value = bar1.max;
            }
            if (bar2) {
                bar2.value = bar2.max;
            }
            if (infoText) {
                infoText.textContent = 'Iniciando Minecraft...';
            }
            if (playingTimeout !== null) {
                clearTimeout(playingTimeout);
            }
            if (loadingContainer) {
                loadingContainer.style.opacity = '0';
            }
            if (playingStatus) {
                playingStatus.style.display = 'none';
                playingStatus.style.opacity = '0';
            }
            playingTimeout = setTimeout(() => {
                playingTimeout = null;
                if (finished)
                    return;
                if (loadingContainer) {
                    loadingContainer.style.display = 'none';
                }
                if (mainBox) {
                    mainBox.classList.add('is-playing');
                }
                notify(downloadedFiles
                    ? `Instancia instalada correctamente: ${instanceName}`
                    : `Instancia ya instalada: ${instanceName}`, 'success');
                openingNoticeTimer = setTimeout(() => {
                    if (!finished && window.lightInstanceRunning) {
                        notify(`Abriendo Minecraft: ${instanceName}`, 'info');
                    }
                }, 5000);
                if (playingStatus) {
                    const statusText = playingStatus.querySelector('span');
                    if (statusText) {
                        statusText.textContent = 'Jugando';
                    }
                    playingStatus.style.display = 'block';
                    requestAnimationFrame(() => {
                        if (!finished) {
                            playingStatus.style.opacity = '1';
                        }
                    });
                }
            }, 5000);
            new logger('Minecraft', '#36b030');
        });
        launch.on('close', code => {
            finishInstallNotice();
            clearTimeout(openingNoticeTimer);
            window.lightInstanceInstalling = false;
            window.lightInstanceRunning = false;
            if (finished)
                return;
            finished = true;
            resetLoadingUI();
            new logger(pkg.name, '#7289da');
        });
        launch.on('error', error => {
            finishInstallNotice();
            clearTimeout(openingNoticeTimer);
            window.lightInstanceInstalling = false;
            window.lightInstanceRunning = false;
            if (finished)
                return;
            finished = true;
            new popup().openPopup({
                title: 'Error',
                content: error?.error ||
                    error?.message ||
                    String(error),
                color: 'red',
                options: true
            });
            resetLoadingUI();
            new logger(pkg.name, '#7289da');
        });
        if (title) {
            title.textContent = instanceName;
        }
        if (playInstanceBTN) {
            playInstanceBTN.style.display = 'none';
        }
        if (infoStartingBOX) {
            infoStartingBOX.style.display = 'block';
        }
        if (mainBox) {
            mainBox.classList.remove('is-playing');
        }
        if (loadingContainer) {
            loadingContainer.style.display = 'flex';
            loadingContainer.style.opacity = '1';
        }
        if (playingStatus) {
            playingStatus.style.opacity = '0';
            playingStatus.style.display = 'none';
        }
        if (bar1) {
            bar1.max = 100;
            bar1.value = 0;
        }
        if (bar2) {
            bar2.max = 100;
            bar2.value = 0;
        }
        if (infoText) {
            infoText.textContent = 'Conectando...';
        }
        if (startImg) {
            const avatar = options.avatarUrl ||
                options.avatar ||
                options.iconUrl ||
                options.icon ||
                options.backgroundUrl ||
                options.background;
            startImg.onerror = () => {
                startImg.onerror = null;
                startImg.src = 'assets/images/instancias/logo.png';
            };
            startImg.src =
                avatar ||
                    'assets/images/instancias/logo.png';
        }
        startLoadingTimer();
        ipcRenderer.send('main-window-progress-load');
        try {
            console.log('Iniciando Minecraft:', instanceName);
            const maybePromise = launch.Launch(opt);
            if (maybePromise &&
                typeof maybePromise.then === 'function') {
                await maybePromise;
            }
            console.log('Proceso de lanzamiento invocado correctamente');
        }
        catch (launchErr) {
            finishInstallNotice();
            clearTimeout(openingNoticeTimer);
            window.lightInstanceInstalling = false;
            window.lightInstanceRunning = false;
            if (finished)
                return;
            finished = true;
            console.error('Error al lanzar Minecraft:', launchErr);
            new popup().openPopup({
                title: 'Error al lanzar',
                content: launchErr?.message ||
                    String(launchErr),
                color: 'red',
                options: true
            });
            resetLoadingUI();
        }
    }
    getdate(e) {
        const date = new Date(e);
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const allMonth = [
            'Enero',
            'Febrero',
            'Marzo',
            'Abril',
            'Mayo',
            'Junio',
            'Julio',
            'Agosto',
            'Septiembre',
            'Octubre',
            'Noviembre',
            'Diciembre'
        ];
        return {
            year,
            month: allMonth[month - 1],
            day
        };
    }
}
export default Home;

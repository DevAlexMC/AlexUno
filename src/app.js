/**
 * @author DevAlex
 * Luuxis License v1.0 (voir fichier LICENSE pour les détails en FR/EN)
 */
const { app, ipcMain, nativeTheme } = require('electron');
const { Microsoft } = require('minecraft-java-core');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const RPC = require('discord-rpc');
const UpdateWindow = require("./assets/js/windows/updateWindow.js");
const MainWindow = require("./assets/js/windows/mainWindow.js");
const CLIENT_ID = '1444191237614866432';
RPC.register(CLIENT_ID);
const rpc = new RPC.Client({ transport: 'ipc' });
let currentInstance = 'Sin Instancia';
let currentPanel = 'home';
async function setActivity(instanceName = currentInstance, panelName = currentPanel) {
    if (!rpc)
        return;
    let details = 'En el menú principal';
    if (panelName === 'settings') {
        details = 'Configurando Launcher';
    }
    else if (panelName === 'login') {
        details = 'En el login';
    }
    rpc.setActivity({
        startTimestamp: new Date(),
        largeImageKey: 'Light',
        largeImageText: 'Light Client',
        smallImageKey: 'setve',
        details: details,
        state: `Jugando: ${instanceName}`,
        instance: true,
    });
}
rpc.on('ready', () => {
    console.log('Rich Presence conectado.');
    setActivity();
});
rpc.login({ clientId: CLIENT_ID }).catch(console.error);
let dev = process.env.NODE_ENV === 'dev';
if (dev) {
    let appPath = path.resolve('./data/Launcher').replace(/\\/g, '/');
    let appdata = path.resolve('./data').replace(/\\/g, '/');
    if (!fs.existsSync(appPath))
        fs.mkdirSync(appPath, { recursive: true });
    if (!fs.existsSync(appdata))
        fs.mkdirSync(appdata, { recursive: true });
    app.setPath('userData', appPath);
    app.setPath('appData', appdata);
}
if (!app.requestSingleInstanceLock())
    app.quit();
else
    app.whenReady().then(() => {
        if (dev)
            return MainWindow.createWindow();
        UpdateWindow.createWindow();
    });
ipcMain.on('main-window-open', () => MainWindow.createWindow());
ipcMain.on('main-window-dev-tools', () => MainWindow.getWindow().webContents.openDevTools({ mode: 'detach' }));
ipcMain.on('main-window-dev-tools-close', () => MainWindow.getWindow().webContents.closeDevTools());
ipcMain.on('main-window-close', () => MainWindow.destroyWindow());
ipcMain.on('main-window-reload', () => MainWindow.getWindow().reload());
ipcMain.on('main-window-progress', (event, options) => MainWindow.getWindow().setProgressBar(options.progress / options.size));
ipcMain.on('main-window-progress-reset', () => MainWindow.getWindow().setProgressBar(-1));
ipcMain.on('main-window-progress-load', () => MainWindow.getWindow().setProgressBar(2));
ipcMain.on('main-window-minimize', () => MainWindow.getWindow().minimize());
ipcMain.on('update-window-close', () => UpdateWindow.destroyWindow());
ipcMain.on('update-window-dev-tools', () => UpdateWindow.getWindow().webContents.openDevTools({ mode: 'detach' }));
ipcMain.on('update-window-progress', (event, options) => UpdateWindow.getWindow().setProgressBar(options.progress / options.size));
ipcMain.on('update-window-progress-reset', () => UpdateWindow.getWindow().setProgressBar(-1));
ipcMain.on('update-window-progress-load', () => UpdateWindow.getWindow().setProgressBar(2));
ipcMain.handle('path-user-data', () => app.getPath('userData'));
ipcMain.handle('appData', e => app.getPath('appData'));
ipcMain.on('main-window-maximize', () => {
    if (MainWindow.getWindow().isMaximized()) {
        MainWindow.getWindow().unmaximize();
    }
    else {
        MainWindow.getWindow().maximize();
    }
});
ipcMain.on('main-window-hide', () => MainWindow.getWindow().hide());
ipcMain.on('main-window-show', () => MainWindow.getWindow().show());
let microsoftAuthInProgress = false;
ipcMain.handle('Microsoft-window', async (_, client_id) => {
    if (microsoftAuthInProgress)
        return { error: true, errorCode: 'AUTH_IN_PROGRESS', stage: 'getAuth' };
    microsoftAuthInProgress = true;
    try {
        const result = await new Microsoft(client_id).getAuth();
        if (result && result.error) {
            const safe = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) ? value : '';
            const code = safe(result.errorCode) || safe(result.code) || safe(result.error) || 'AUTH_ERROR';
            const stage = safe(result.errorType) || 'getAuth';
            console.warn('[Microsoft-window] Servicio rechazó autenticación:', { code, stage });
            return { error: true, errorCode: code, stage };
        }
        return result;
    }
    catch (error) {
        const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) ? value : '';
        const code = safeCode(error?.code) || safeCode(error?.error) || 'AUTH_EXCEPTION';
        console.warn('[Microsoft-window] Autenticación fallida; código:', code);
        return { error: true, errorCode: code, stage: 'getAuth' };
    }
    finally {
        microsoftAuthInProgress = false;
    }
});
ipcMain.handle('light-minecraft-profile', async (_, request) => {
    const { action, token, variant, capeId, bytes } = request || {};
    if (!['profile', 'skin', 'cape'].includes(action) || typeof token !== 'string' || !token || token.length > 8192)
        throw new Error('Sesión de Minecraft no válida.');
    const base = 'https://api.minecraftservices.com/minecraft/profile';
    const headers = { Authorization: `Bearer ${token}` };
    let response;
    if (action === 'profile')
        response = await fetch(base, { headers });
    else if (action === 'skin') {
        if (!Array.isArray(bytes) || bytes.length < 100 || bytes.length > 2 * 1024 * 1024 || !['classic', 'slim'].includes(variant))
            throw new Error('Skin PNG inválida.');
        const buffer = Buffer.from(bytes);
        if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a')
            throw new Error('El archivo no es PNG.');
        const form = new FormData();
        form.append('variant', variant);
        form.append('file', new Blob([buffer], { type: 'image/png' }), 'skin.png');
        response = await fetch(`${base}/skins`, { method: 'POST', headers, body: form });
    }
    else {
        if (capeId && (typeof capeId !== 'string' || capeId.length > 128))
            throw new Error('Capa inválida.');
        const profileResponse = await fetch(base, { headers });
        if (!profileResponse.ok)
            throw new Error(`No se pudo comprobar la cuenta (${profileResponse.status}).`);
        const profile = await profileResponse.json();
        if (capeId && !(profile.capes || []).some(c => c.id === capeId))
            throw new Error('La cuenta no posee esta capa.');
        response = await fetch(`${base}/capes/active`, capeId
            ? { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ capeId }) }
            : { method: 'DELETE', headers });
    }
    if (!response.ok) {
        if (response.status === 401 || response.status === 403)
            throw new Error('La sesión premium caducó. Vuelve a iniciar sesión con Microsoft.');
        throw new Error(`Minecraft rechazó la solicitud (${response.status}).`);
    }
    if (action === 'profile')
        return response.json();
    return { ok: true };
});
ipcMain.handle('is-dark-theme', (_, theme) => {
    if (theme === 'dark')
        return true;
    if (theme === 'light')
        return false;
    return nativeTheme.shouldUseDarkColors;
});
ipcMain.on('instance-changed', (event, data) => {
    currentInstance = data.instanceName;
    setActivity(currentInstance, currentPanel);
    console.log(`Instancia cambió a: ${currentInstance}`);
});
ipcMain.on('panel-changed', (event, data) => {
    currentPanel = data.panelName;
    setActivity(currentInstance, currentPanel);
    console.log(`Panel cambió a: ${currentPanel}`);
});
app.on('window-all-closed', () => app.quit());
autoUpdater.autoDownload = false;
ipcMain.handle('update-app', async () => {
    return await new Promise(async (resolve, reject) => {
        autoUpdater.checkForUpdates().then(res => {
            resolve(res);
        }).catch(error => {
            reject({
                error: true,
                message: error
            });
        });
    });
});
autoUpdater.on('update-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow)
        updateWindow.webContents.send('updateAvailable');
});
ipcMain.on('start-update', () => {
    autoUpdater.downloadUpdate();
});
autoUpdater.on('update-not-available', () => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow)
        updateWindow.webContents.send('update-not-available');
});
autoUpdater.on('update-downloaded', () => {
    autoUpdater.quitAndInstall();
});
autoUpdater.on('download-progress', (progress) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow)
        updateWindow.webContents.send('download-progress', progress);
});
autoUpdater.on('error', (err) => {
    const updateWindow = UpdateWindow.getWindow();
    if (updateWindow)
        updateWindow.webContents.send('error', err);
});

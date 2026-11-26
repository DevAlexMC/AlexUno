import { changePanel, database, revokeSession } from '../utils.js';
import { checkAuthorization, selectedAccount, showAuthorizationStatus } from '../utils/authorization.js';
import { notify } from '../utils/toast.js';
export default class Authorization {
    static id = 'authorization';
    init() {
        const form = document.querySelector('#light-auth-form');
        const input = document.querySelector('#light-auth-code');
        const button = form.querySelector('button');
        const logout = document.querySelector('#light-auth-logout');
        let busy = false;
        let polling = false;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (busy)
                return;
            const code = input.value.trim();
            if (!code) {
                notify('Introduce un código de autorización.', 'warning');
                return;
            }
            busy = true;
            button.disabled = true;
            logout.disabled = true;
            try {
                const account = await selectedAccount();
                const result = await checkAuthorization(code);
                if (result.reason === 'banned') {
                    await revokeSession(result, account);
                    return;
                }
                if (result.allowed) {
                    input.value = '';
                    notify('Acceso al launcher autorizado.', 'success');
                    await changePanel('home', result);
                }
                else {
                    const messages = { banned: 'Este usuario está baneado de este cliente.', not_whitelisted: 'No estás registrado en la whitelist de autorización.', invalid_code: 'Código incorrecto.', config: 'La configuración privada del servidor no está disponible.', connection: 'No se pudo conectar con el servidor.', session: 'Vuelve a iniciar sesión con Microsoft.' };
                    notify(messages[result.reason] || 'No tienes autorización.', 'warning');
                }
            }
            finally {
                busy = false;
                button.disabled = false;
                logout.disabled = false;
            }
        });
        logout.addEventListener('click', async () => {
            if (busy)
                return;
            busy = true;
            logout.disabled = true;
            button.disabled = true;
            try {
                localStorage.setItem('light-auth-force-login', '1');
                const db = new database();
                const cfg = await db.readData('configClient');
                if (cfg?.account_selected) {
                    await db.deleteData('accounts', cfg.account_selected);
                    cfg.account_selected = null;
                    await db.updateData('configClient', cfg);
                }
                input.value = '';
                window.dispatchEvent(new Event('light-accounts-changed'));
                await changePanel('login');
            }
            catch (_) {
                notify('No se pudo cerrar sesión.', 'error');
            }
            finally {
                busy = false;
                logout.disabled = false;
                button.disabled = false;
            }
        });
        setInterval(async () => { if (busy || polling || !document.querySelector('.panel.authorization.active'))
            return; polling = true; try {
            const account = await selectedAccount();
            const result = await checkAuthorization();
            if (busy || !document.querySelector('.panel.authorization.active'))
                return;
            if (result.reason === 'banned')
                await revokeSession(result, account);
            else if (result.allowed)
                await changePanel('home', result);
            else
                showAuthorizationStatus(result, await selectedAccount());
        }
        finally {
            polling = false;
        } }, 3000);
    }
}

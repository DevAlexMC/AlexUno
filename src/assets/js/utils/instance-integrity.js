const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const f = fs.promises;
async function stat(p) { try {
    return await f.lstat(p);
}
catch (e) {
    if (e.code === 'ENOENT')
        return null;
    throw e;
} }
async function safeDir(p) { const s = await stat(p); if (s && (!s.isDirectory() || s.isSymbolicLink()))
    throw Error('Carpeta de instancia no válida'); return s; }
async function hash(p) { return new Promise((resolve, reject) => { const h = crypto.createHash('sha256'); const r = fs.createReadStream(p); r.on('error', reject); r.on('data', b => h.update(b)); r.on('end', () => resolve(h.digest('hex'))); }); }
export async function inspectMods(opt) {
    if (typeof opt.instance !== 'string' || !opt.instance || /[\\/:\x00-\x1f]/.test(opt.instance) || ['.', '..'].includes(opt.instance))
        throw Error('Instancia inválida');
    const base = path.resolve(opt.path), instances = path.join(base, 'instances'), root = path.join(instances, opt.instance), mods = path.join(root, 'mods');
    for (const p of [base, instances, root, mods])
        await safeDir(p);
    const response = await fetch(opt.url, { timeout: 15000, redirect: 'follow', headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok)
        throw Error('No se pudo consultar la instancia');
    const list = await response.json();
    if (!Array.isArray(list))
        throw Error('Lista de archivos inválida');
    const expected = new Map();
    for (const item of list) {
        if (!item || typeof item.path !== 'string')
            throw Error('Archivo inválido');
        if (!/^mods\//i.test(item.path))
            continue;
        const parts = item.path.split('/');
        if (parts.some(p => !p || p === '.' || p === '..' || /[\\:\x00-\x1f]/.test(p)) || !/^[a-f0-9]{64}$/i.test(item.sha256 || ''))
            throw Error('Manifiesto SHA-256 inválido');
        const key = parts.slice(1).join('/');
        if (expected.has(key))
            throw Error('Archivo duplicado');
        expected.set(key, item.sha256.toLowerCase());
    }
    const bad = [], missing = new Set(expected.keys());
    async function walk(dir, prefix = '') { for (const entry of await f.readdir(dir, { withFileTypes: true })) {
        const rel = prefix + entry.name, p = path.join(dir, entry.name);
        const s = await f.lstat(p);
        if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory()))
            throw Error('Enlace o archivo especial en mods');
        if (s.isDirectory()) {
            await walk(p, rel + '/');
            continue;
        }
        missing.delete(rel);
        if (!expected.has(rel) || await hash(p) !== expected.get(rel))
            bad.push({ rel, p });
    } }
    if (await safeDir(mods))
        await walk(mods);
    return { bad, missing: [...missing], fingerprint: JSON.stringify([...expected].sort()), root };
}
export async function removeBadMods(result) { for (const item of result.bad) {
    const s = await stat(item.p);
    if (!s || !s.isFile() || s.isSymbolicLink())
        throw Error('Archivo cambió durante la comprobación');
    await f.unlink(item.p);
} }
export function showIntegrityBlock() {
    document.getElementById('light-integrity-block')?.remove();
    const el = document.createElement('div');
    el.id = 'light-integrity-block';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.32);color:white;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px;box-sizing:border-box;';
    el.innerHTML = '<div style="position:relative;width:540px;max-width:100%;box-sizing:border-box;background:#09090c;border:1px solid #333;padding:44px 30px 30px;box-shadow:0 12px 40px #0008"><button type="button" aria-label="Cerrar" style="position:absolute;top:12px;right:16px;background:none;border:0;color:white;font-size:32px;cursor:pointer">×</button><div style="max-width:480px"><h1 style="font-size:25px;color:#fff;margin-bottom:22px">Inicio de Minecraft bloqueado</h1><p style="font-size:16px;color:#ddd">Se han detectado archivos no autorizados en esta instancia.</p><p style="font-size:14px;color:#aaa;margin-top:24px">Pulsa PLAY nuevamente para eliminar los archivos no autorizados e iniciar la instancia de forma segura.</p></div></div>';
    el.querySelector('button').onclick = () => el.remove();
    document.body.appendChild(el);
    el.querySelector('button').focus();
}

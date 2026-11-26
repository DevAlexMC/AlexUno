"use strict";
/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0/
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const os_1 = __importDefault(require("os"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const events_1 = __importDefault(require("events"));
const node_7z_1 = __importDefault(require("node-7z"));
const _7zip_bin_1 = __importDefault(require("7zip-bin"));
const Index_js_1 = require("../utils/Index.js");
const Downloader_js_1 = __importDefault(require("../utils/Downloader.js"));
class JavaDownloader extends events_1.default {
    constructor(options) {
        super();
        this.options = options;
    }
    async getJavaFiles(jsonversion) {
        if (this.options.java.version)
            return await this.getJavaOther(jsonversion, this.options.java.version);
        const archMapping = {
            win32: { x64: 'windows-x64', ia32: 'windows-x86', arm64: 'windows-arm64' },
            darwin: { x64: 'mac-os', arm64: this.options.intelEnabledMac ? "mac-os" : "mac-os-arm64" },
            linux: { x64: 'linux', ia32: 'linux-i386' }
        };
        const osPlatform = os_1.default.platform();
        const arch = os_1.default.arch();
        const osArchMapping = archMapping[osPlatform];
        const javaVersion = jsonversion.javaVersion?.component || 'jre-legacy';
        let files = [];
        if (!osArchMapping)
            return await this.getJavaOther(jsonversion);
        const archOs = osArchMapping[arch];
        const javaVersionsJson = await (0, node_fetch_1.default)(`https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json`).then(res => res.json());
        const versionName = javaVersionsJson[archOs]?.[javaVersion]?.[0]?.version?.name;
        if (!versionName)
            return await this.getJavaOther(jsonversion);
        const manifestUrl = javaVersionsJson[archOs][javaVersion][0]?.manifest?.url;
        const manifest = await (0, node_fetch_1.default)(manifestUrl).then(res => res.json());
        const javaFiles = Object.entries(manifest.files);
        const java = javaFiles.find(([path]) => path.endsWith(process.platform === 'win32' ? 'bin/javaw.exe' : 'bin/java'))[0];
        const toDelete = java.replace(process.platform === 'win32' ? 'bin/javaw.exe' : 'bin/java', '');
        for (let [path, info] of javaFiles) {
            if (info.type == "directory")
                continue;
            if (!info.downloads)
                continue;
            let file = {};
            file.path = `runtime/jre-${versionName}-${archOs}/${path.replace(toDelete, "")}`;
            file.executable = info.executable;
            file.sha1 = info.downloads.raw.sha1;
            file.size = info.downloads.raw.size;
            file.url = info.downloads.raw.url;
            file.type = "Java";
            files.push(file);
        }
        return {
            files,
            path: path_1.default.resolve(this.options.path, `runtime/jre-${versionName}-${archOs}/bin/java`),
        };
    }
    async getJavaOther(jsonversion, versionDownload) {
        const majorVersion = versionDownload || jsonversion.javaVersion?.majorVersion || 8;
        const { platform, arch } = this.getPlatformArch();
        const javaVersionURL = `https://api.adoptium.net/v3/assets/latest/${majorVersion}/hotspot?` + new URLSearchParams({
            image_type: this.options.java.type,
            architecture: arch,
            os: platform
        }).toString();
        const javaVersions = await (0, node_fetch_1.default)(javaVersionURL).then(res => res.json());
        const java = javaVersions[0];
        if (!java)
            return { error: true, message: "No Java found" };
        const { checksum, link: url, name: fileName } = java.binary.package;
        const pathFolder = path_1.default.resolve(this.options.path, `runtime/jre-${majorVersion}`);
        const filePath = path_1.default.join(pathFolder, fileName);
        let javaPath = path_1.default.join(pathFolder, 'bin', 'java');
        if (platform === 'mac')
            javaPath = path_1.default.join(pathFolder, 'Contents', 'Home', 'bin', 'java');
        if (!fs_1.default.existsSync(javaPath)) {
            await this.verifyAndDownloadFile({ filePath, pathFolder, fileName, url, checksum });
            await this.extract(filePath, pathFolder);
            fs_1.default.unlinkSync(filePath);
            if (filePath.endsWith('.tar.gz')) {
                const tarFilePath = filePath.replace('.gz', '');
                await this.extract(tarFilePath, pathFolder);
                if (fs_1.default.existsSync(tarFilePath))
                    fs_1.default.unlinkSync(tarFilePath);
            }
            const extractedItems = fs_1.default.readdirSync(pathFolder);
            if (extractedItems.length === 1) {
                const extractedFolder = path_1.default.join(pathFolder, extractedItems[0]);
                const stat = fs_1.default.statSync(extractedFolder);
                if (stat.isDirectory()) {
                    const subItems = fs_1.default.readdirSync(extractedFolder);
                    for (const item of subItems) {
                        const srcPath = path_1.default.join(extractedFolder, item);
                        const destPath = path_1.default.join(pathFolder, item);
                        fs_1.default.renameSync(srcPath, destPath);
                    }
                    fs_1.default.rmdirSync(extractedFolder);
                }
            }
            if (platform !== 'windows')
                fs_1.default.chmodSync(javaPath, 0o755);
        }
        return { files: [], path: javaPath };
    }
    getPlatformArch() {
        const platformMap = { win32: 'windows', darwin: 'mac', linux: 'linux' };
        const archMap = { x64: 'x64', ia32: 'x32', arm64: 'aarch64', arm: 'arm' };
        const platform = platformMap[os_1.default.platform()] || os_1.default.platform();
        let arch = archMap[os_1.default.arch()] || os_1.default.arch();
        if (os_1.default.platform() === 'darwin' && os_1.default.arch() === 'arm64' && this.options.intelEnabledMac) {
            arch = 'x64';
        }
        return { platform, arch };
    }
    async verifyAndDownloadFile({ filePath, pathFolder, fileName, url, checksum }) {
        if (fs_1.default.existsSync(filePath)) {
            const existingChecksum = await (0, Index_js_1.getFileHash)(filePath, 'sha256');
            if (existingChecksum !== checksum) {
                fs_1.default.unlinkSync(filePath);
                fs_1.default.rmSync(pathFolder, { recursive: true, force: true });
            }
        }
        if (!fs_1.default.existsSync(filePath)) {
            fs_1.default.mkdirSync(pathFolder, { recursive: true });
            const download = new Downloader_js_1.default();
            download.on('progress', (downloaded, size) => {
                this.emit('progress', downloaded, size, fileName);
            });
            await download.downloadFile(url, pathFolder, fileName);
        }
        const downloadedChecksum = await (0, Index_js_1.getFileHash)(filePath, 'sha256');
        if (downloadedChecksum !== checksum) {
            throw new Error("Java checksum failed");
        }
    }
    async extract(filePath, destPath) {
        if (os_1.default.platform() !== 'win32')
            fs_1.default.chmodSync(_7zip_bin_1.default.path7za, 0o755);
        await new Promise((resolve, reject) => {
            const extract = node_7z_1.default.extractFull(filePath, destPath, {
                $bin: _7zip_bin_1.default.path7za,
                recursive: true,
                $progress: true,
            });
            extract.on('end', () => resolve());
            extract.on('error', (err) => reject(err));
            extract.on('progress', (progress) => {
                if (progress.percent > 0)
                    this.emit('extract', progress.percent);
            });
        });
    }
}
exports.default = JavaDownloader;

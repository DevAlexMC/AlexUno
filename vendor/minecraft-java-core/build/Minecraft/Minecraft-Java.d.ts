/**
 * @author Luuxis
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0/
 */
import EventEmitter from 'events';
export default class JavaDownloader extends EventEmitter {
    options: any;
    constructor(options: any);
    getJavaFiles(jsonversion: any): Promise<{
        error: boolean;
        message: string;
        files?: undefined;
        path?: undefined;
    } | {
        files: any[];
        path: string;
        error?: undefined;
        message?: undefined;
    }>;
    getJavaOther(jsonversion: any, versionDownload?: any): Promise<{
        error: boolean;
        message: string;
        files?: undefined;
        path?: undefined;
    } | {
        files: any[];
        path: string;
        error?: undefined;
        message?: undefined;
    }>;
    getPlatformArch(): {
        platform: any;
        arch: any;
    };
    verifyAndDownloadFile({ filePath, pathFolder, fileName, url, checksum }: {
        filePath: any;
        pathFolder: any;
        fileName: any;
        url: any;
        checksum: any;
    }): Promise<void>;
    extract(filePath: string, destPath: string): Promise<void>;
}

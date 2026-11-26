/**
 * @author DevAlex
 * @license CC-BY-NC 4.0 - https://creativecommons.org/licenses/by-nc/4.0
 */
const nodeFetch = require('node-fetch');
export class skin2D {
    async creatHeadTexture(data) {
        let image = await getData(data);
        return await new Promise((resolve, reject) => {
            image.addEventListener('load', e => {
                let cvs = document.createElement('canvas');
                cvs.width = 8;
                cvs.height = 8;
                let ctx = cvs.getContext('2d');
                ctx.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
                ctx.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
                return resolve(cvs.toDataURL());
            });
        });
    }
    async creatBustTexture(data) {
        const image = await getData(data);
        return new Promise((resolve, reject) => {
            const draw = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 16;
                canvas.height = 16;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                const part = (x, y, w, h, dx, dy) => ctx.drawImage(image, x, y, w, h, dx, dy, w, h);
                const modern = image.naturalHeight >= 64;
                part(8, 8, 8, 8, 4, 0);
                part(20, 20, 8, 8, 4, 8);
                part(44, 20, 4, 8, 0, 8);
                part(modern ? 36 : 44, modern ? 52 : 20, 4, 8, 12, 8);
                if (modern) {
                    part(20, 36, 8, 8, 4, 8);
                    part(44, 36, 4, 8, 0, 8);
                    part(52, 52, 4, 8, 12, 8);
                }
                part(40, 8, 8, 8, 4, 0);
                resolve(canvas.toDataURL('image/png'));
            };
            if (image.complete && image.naturalWidth)
                draw();
            else {
                image.addEventListener('load', draw, { once: true });
                image.addEventListener('error', reject, { once: true });
            }
        });
    }
}
async function getData(data) {
    if (data.startsWith('http')) {
        let response = await nodeFetch(data);
        let buffer = await response.buffer();
        data = `data:image/png;base64,${await buffer.toString('base64')}`;
    }
    let img = new Image();
    img.src = data;
    return img;
}

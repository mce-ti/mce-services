const { createCanvas, loadImage }   = require('canvas');
const ffmpegPath                    = require('ffmpeg-static');
const GIFEncoder                    = require('gifencoder');
const ffmpeg                        = require('fluent-ffmpeg');
const puppeteer                     = require('puppeteer');
const express                       = require('express');
const multer                        = require('multer');
const path                          = require('path');
const cors                          = require('cors');
const fs                            = require('fs');
const rimraf                        = require('rimraf');

const { puppeteer_launch_props, port } = require('./constants');
const { newInitTime, getResultTime, sleep, isDefined, puppeteerDataDir } = require('./utils');

const upload = multer({ dest: 'uploads/' });

const app = express();

app.use(cors());
app.use(express.json());

app.post('/convert-gif-to-mp4', upload.single('gif'), async (req, res) => {
    const gifPath = req.file.path;
    const filename = `${req.file.filename.replace('.gif', '')}.mp4`;
    const mp4Path = path.join('uploads/', filename);

    const { body: { width, height, id_pedido = '' } } = req;

    const scale = `${width || 750}:${height || 1334}`;

    console.log('convert-gif-to-mp4', { id_pedido, scale });

    const initTime = newInitTime();

    const convert = async () => new Promise(resolve => {
        ffmpeg.setFfmpegPath(ffmpegPath)
        ffmpeg(gifPath)
            .output(mp4Path)
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-movflags faststart',
                '-profile:v baseline',
                '-level 3.0',
                '-pix_fmt yuv420p',
                '-vf scale=' + scale
            ])
            .on('end', () => {
                fs.unlink(gifPath, err => err && console.error(err));
                resolve(mp4Path);
            })
            .on('error', (err) => {
                console.error(err);
                resolve();
            })
            .run();
    })

    await convert();

    const filePath = `./uploads/${filename}`;

    res.download(filePath, filename, err => {
        err
            ? console.log('Error downloading MP4:', err)
            : console.log(`MP4 ${id_pedido} downloaded successfully in ${getResultTime(initTime)}`);

        fs.unlink(filePath, err => err && console.error(err));
    })
});

app.get('/generate-gif-by-order-id/:id/:product', async (req, res) => {
    const { id, product } = req.params;

    const width = parseInt(req.query?.width || '0') || 375;
    const height = parseInt(req.query?.height || '0') || 667;

    console.log('generate-gif-by-order-id', { id, product, width, height });

    if (!id || !product) {
        return res.status(403).json({
            status: false,
            message: "id is required"
        });
    }

    const initTime = newInitTime();

    try {
        const browser = await puppeteer.launch({ ...puppeteer_launch_props, userDataDir: puppeteerDataDir('gif_data') });

        const page = await browser.newPage();

        await page.setViewport({
            width,
            height,
            deviceScaleFactor: 1,
        });

        await page.goto(`https://www.meucopoeco.com.br/site/customizer/${id}/${product}?origem=gif-service`);

        await page.waitForSelector('.three-loaded', { timeout: 0 })

        await sleep(1000);

        const dir = './uploads/' + id;

        !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

        for (let i = 1; i < 32; i++) {
            await page.addScriptTag({ content: `moveCupPosition(${i})` })

            await sleep(100);

            await page.screenshot({
                type: 'png',
                path: `${dir}/${i}.png`,
                clip: { x: 0, y: 0, width, height }
            });
        }

        await browser.close();
    } catch (error) {
        console.log(error)
        return res.sendStatus(403)
    }

    // ---------------------------------------- \\

    const filename = `gif-${id}.gif`;
    const gifPath = `${dir}/${filename}`;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    const encoder = new GIFEncoder(width, height);

    encoder.createReadStream().pipe(fs.createWriteStream(gifPath));
    encoder.start();
    encoder.setRepeat(0);
    encoder.setDelay(100);
    encoder.setQuality(100);

    const imagePaths = fs.readdirSync(dir);
    const gifPaths = imagePaths.filter(name => name.includes('png'));

    await (() => new Promise(resolve => {
        for (let index = 1; index <= 3; index++) {
            gifPaths
                .sort((a, b) => parseInt(a) - parseInt(b))
                .forEach(async (imagePath, i) => {
                    const filePath = path.join(dir, imagePath);
                    const image = await loadImage(filePath);

                    ctx.drawImage(image, 0, 0, image.width, image.height, 0, 0, canvas.width, canvas.height);

                    encoder.addFrame(ctx);

                    if (i === (gifPaths.length - 1) && index == 3) {
                        encoder.finish();
                        await sleep(1000);
                        resolve(true);
                    }
                })
        }
    }))()

    res.download(gifPath, filename, err => {
        err
            ? console.log(`Error downloading GIF ${id}-${product}`, err)
            : console.log(`GIF ${id}-${product} downloaded successfully in ${getResultTime(initTime)}`);

        rimraf(dir, () => { });
    })
});

app.post('/generate-pdf', async (req, res) => {
    const initTime = newInitTime();

    let tryProcess = true;
    let timesToTry = 15;
    let times = 0;

    while (tryProcess) {
        times++;

        try {
            const reqOpts = req.body.options || {}
            const url = req.body.url
        
            const filename = `pdf-${new Date().getTime()}.pdf`
            const path = `./uploads/${filename}`
        
            const options = { path }
        
            isDefined(reqOpts.displayHeaderFooter)  && (options['displayHeaderFooter'] = reqOpts.displayHeaderFooter);
            isDefined(reqOpts.footerTemplate)       && (options['footerTemplate'] = reqOpts.footerTemplate);
            isDefined(reqOpts.format)               && (options['format'] = reqOpts.format);
            isDefined(reqOpts.headerTemplate)       && (options['headerTemplate'] = reqOpts.headerTemplate);
            isDefined(reqOpts.height)               && (options['height'] = reqOpts.height);
            isDefined(reqOpts.landscape)            && (options['landscape'] = reqOpts.landscape);
            isDefined(reqOpts.omitBackground)       && (options['omitBackground'] = reqOpts.omitBackground);
            isDefined(reqOpts.pageRanges)           && (options['pageRanges'] = reqOpts.pageRanges);
            isDefined(reqOpts.preferCSSPageSize)    && (options['preferCSSPageSize'] = reqOpts.preferCSSPageSize);
            isDefined(reqOpts.printBackground)      && (options['printBackground'] = reqOpts.printBackground);
            isDefined(reqOpts.scale)                && (options['scale'] = reqOpts.scale);
            isDefined(reqOpts.timeout)              && (options['timeout'] = reqOpts.timeout);
            isDefined(reqOpts.width)                && (options['width'] = reqOpts.width);
        
            const browser = await puppeteer.launch({ ...puppeteer_launch_props, userDataDir: puppeteerDataDir('pdf_data') });

            tryProcess = false;
            
            const page = await browser.newPage();
            
            await page.goto(url, { waitUntil: 'networkidle0' });
            
            await sleep(250);
        
            await page.pdf(options);
        
            await browser.close();
        
            return res.download(path, filename, err => {
                const log = err ? ['Error downloading PDF', req.body, err] : [`PDF (${url}) Downloaded successfully in ${getResultTime(initTime)}`];
        
                console.log(...log);
        
                fs.unlink(path, _unlinkErr => { });
            })
        } catch (error) {
            if (timesToTry > times) {
                await sleep(1000);
            } else {
                console.log(error)
                return res.sendStatus(403)
            }
        }
    }    
});

app.listen(port, () => console.log(`Server running on port ${port}`));

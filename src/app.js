const { createCanvas, loadImage } = require('canvas');
const ffmpegPath = require('ffmpeg-static')
const GIFEncoder = require('gifencoder');
const ffmpeg = require('fluent-ffmpeg');
const puppeteer = require('puppeteer');
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const rimraf = require('rimraf');

const newInitTime = () => new Date().getTime();
const getResultTime = (initTime = 0) => ((new Date().getTime() - initTime) / 1000).toFixed(2) + 's';

const puppeteer_minimal_args = [
    '--autoplay-policy=user-gesture-required',
    '--disable-background-networking',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-client-side-phishing-detection',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-dev-shm-usage',
    '--disable-domain-reliability',
    '--disable-extensions',
    '--disable-features=AudioServiceOutOfProcess',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-offer-store-unmasked-wallet-cards',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-setuid-sandbox',
    '--disable-speech-api',
    '--disable-sync',
    '--hide-scrollbars',
    '--ignore-gpu-blacklist',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-first-run',
    '--no-pings',
    '--no-sandbox',
    '--no-zygote',
    '--password-store=basic',
    '--use-gl=swiftshader',
    '--use-mock-keychain',
];

const puppeteer_launch_props = {
    args: puppeteer_minimal_args,
    userDataDir: './puppeteer_cache',
    executablePath: '/usr/bin/chromium-browser',
    headless: 'new'
};

const app = express()
app.use(cors())
app.use(express.json())

const upload = multer({ dest: 'uploads/' })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

app.get('/', (_req, res) => res.send('Server is running'));

app.post('/convert-gif-to-mp4', upload.single('gif'), async (req, res) => {
    const gifPath = req.file.path;
    const filename = `${req.file.filename.replace('.gif', '')}.mp4`;
    const mp4Path = path.join('uploads/', filename);

    const { body: { width, height, id_pedido = '' } } = req;

    const scale = `${width || 750}:${height || 1334}`;

    console.log('convert-gif-to-mp4', `id_pedido: ${id_pedido}`, `scale: ${scale}`);

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
            ? console.log('Error downloading file:', err)
            : console.log('File downloaded successfully in ' + getResultTime(initTime));

        fs.unlink(filePath, err => err && console.error(err));
    })
});

app.get('/generate-gif-by-order-id/:id/:product', async (req, res) => {
    const id = req.params?.id;
    const product = req.params?.product;

    const width = parseInt(req.query?.width || '0') || 375;
    const height = parseInt(req.query?.height || '0') || 667;

    console.log('generate-gif-by-order-id', {
        id,
        product,
        width,
        height
    });

    if (!id || !product) {
        return res.status(403).json({
            status: false,
            message: "id is required"
        });
    }

    const initTime = newInitTime();

    const browser = await puppeteer.launch(puppeteer_launch_props);

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

        await sleep(200);

        await page.screenshot({
            type: 'png',
            path: `${dir}/${i}.png`,
            clip: {
                x: 0,
                y: 0,
                width,
                height
            }
        });
    }

    await browser.close();

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
            ? console.log(`Error downloading gif - id_pedido: ${id} id_produto: ${product}:`, err)
            : console.log(`gif - id_pedido: ${id} id_produto: ${product} downloaded successfully in ` + getResultTime(initTime));

        rimraf(dir, () => { });
    })
});

app.post('/generate-pdf', async (req, res) => {
    const isDefined = value => typeof value !== 'undefined'

    const initTime = newInitTime();

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
    
        const browser = await puppeteer.launch(puppeteer_launch_props);
        
        const page = await browser.newPage();
       
        await sleep(250);
        
        await page.goto(url, { waitUntil: 'networkidle0' });
        
        await sleep(250);
    
        await page.pdf(options);
    
        await browser.close();
    
        return res.download(path, filename, err => {
            const log = err ? ['Error downloading pdf', req.body, err] : ['Downloaded successfully in ' + getResultTime(initTime), req.body];
    
            console.log(...log);
    
            fs.unlink(path, _unlinkErr => { });
        })
    } catch (error) {
        console.log(error)
        return res.sendStatus(403)
    }

});

const port = process.env.PORT || 3000;

app.listen(port, () => console.log(`Server running on port ${port}`));

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

const app = express()
app.use(cors())

const upload = multer({ dest: 'uploads/' })

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

app.get('/', (_req, res) => {
    res.send('Server is running')
})

app.post('/convert-gif-to-mp4', upload.single('gif'), async (req, res) => {
    const gifPath = req.file.path
    const filename = `${req.file.filename.replace('.gif', '')}.mp4`
    const mp4Path = path.join('uploads/', filename)

    const { body: { width = 750, height = 1334 } } = req

    const scale = `${width}:${height}` 

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
            : console.log('File downloaded successfully');

        fs.unlink(filePath, err => err && console.error(err));
    })
})

app.get('/generate-gif-by-order-id/:id', async (req, res) => {
    const id = req.params?.id;

    if (!id) {
        res.json({
            status: false,
            message: "id is required"
        });

        return;
    }

    const width = 375;
    const height = 667;

    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    await page.setViewport({
        width,
        height,
        deviceScaleFactor: 1,
    });

    await page.goto(`https://www.meucopoeco.com.br/site/customizer/${id}/1?origem=gif-service`);

    await page.waitForSelector('.three-loaded', { timeout: 0 })

    await sleep(2000);

    const dir = './uploads/' + id;

    !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

    for (let i = 1; i < 32; i++) {
        await page.addScriptTag({ content: `moveCupPosition(${i})` })

        await sleep(1000);

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
            ? console.log('Error downloading file:', err)
            : console.log('File downloaded successfully');

        rimraf(dir, () => {});
    })
})


const port = process.env.PORT || 3000;

app.listen(port, () => console.log(`Server running on port ${port}`));

const { createCanvas, loadImage } = require('canvas');
const ffmpegPath = require('ffmpeg-static');
const GIFEncoder = require('gifencoder');
const ffmpeg = require('fluent-ffmpeg');
const puppeteer = require('puppeteer');
const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const rimraf = require('rimraf');
const db = require('./db');
const PedidosModel = require('./models/pedidosModel');
const FinanceiroModel = require('./models/financeiroModel');
const { processarJobCalco } = require('./processarJobCalco');

const { puppeteer_launch_props, port } = require('./constants');
const { newInitTime, getResultTime, sleep, isDefined, puppeteerDataDir } = require('./utils');


const upload = multer({ dest: 'uploads/' });

const app = express();


app.use(cors());
app.use(express.json());

app.post('/convert-gif-to-mp4', upload.single('gif'), async (req, res) => {
    try {
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
    } catch (error) {
        console.log(error)
        return res.status(403).json({
            status: false,
            message: "id is required"
        })
    }
});

app.get('/generate-gif-by-order-id/:id/:product', async (req, res) => {
    const { id, product } = req.params;
    const width = parseInt(req.query?.width || '0') || 500;
    const height = parseInt(req.query?.height || '0') || 667;

    console.log('generate-gif-by-order-id', { id, product });

    const initTime = newInitTime();
    const uniqueDir = puppeteerDataDir(`gif_data_${id}_${Date.now()}`);
    let browser = null;

    try {
        browser = await puppeteer.launch({ 
            ...puppeteer_launch_props, 
            userDataDir: uniqueDir,
            headless: "new",
            
            // AUMENTO CRÍTICO: Deixa o Chrome responder devagar sem o Puppeteer cancelar
            protocolTimeout: 300000, // 5 minutos (evita o Runtime.callFunctionOn timed out)
            timeout: 60000, // Timeout de inicialização

            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                
                // --- O "PEDIDO" DO LOG DO BROWSER ---
                // Isso autoriza o uso de CPU para WebGL sem restrições de segurança
                '--enable-unsafe-swiftshader',
                '--use-gl=swiftshader', // Reforça o uso do SwiftShader
                
                // Otimizações de Performance
                '--disable-extensions',
                '--disable-component-extensions-with-background-pages',
                '--disable-default-apps',
                '--mute-audio',
                '--hide-scrollbars',
                '--disable-notifications',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ]
        });

        const page = await browser.newPage();

        // Patch do JS (Mantido pois funciona)
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(window, 'THREE', {
                get() { return this._THREE; },
                set(val) {
                    this._THREE = val;
                    if (val && val.Loader && !val.Loader.Handlers) {
                        val.Loader.Handlers = {
                            get: (regex) => val.DefaultLoadingManager.getHandler(regex),
                            add: (regex, loader) => val.DefaultLoadingManager.addHandler(regex, loader)
                        };
                    }
                }
            });
        });

        page.on('console', msg => {
            const txt = msg.text();
            // Filtra apenas logs importantes
            if (txt.includes('Error') || txt.includes('WebGL') || txt.includes('GPU')) {
                console.log('BROWSER LOG:', txt);
            }
        });

        await page.setViewport({ width, height, deviceScaleFactor: 1 });

        // --- MUDANÇA ESTRATÉGICA ---
        // networkidle0 é muito pesado e causa timeout. 
        // Usamos domcontentloaded que é mais rápido, pois vamos esperar o seletor .three-loaded depois de qualquer jeito.
        await page.goto(`https://www.meucopoeco.com.br/site/customizer/${id}/${product}?origem=gif-service&t=${Date.now()}`, {
            waitUntil: 'domcontentloaded', 
            timeout: 120000 // 2 minutos para carregar o HTML inicial
        });

        console.log('Esperando o 3D carregar (pode demorar no SwiftShader)...');
        
        // Aqui é onde o 3D carrega. Aumentei para 120s para garantir.
        await page.waitForSelector('.three-loaded', { timeout: 120000 });
        console.log('SUCESSO: 3D Carregado!');

        await sleep(2000); 

        const dir = './uploads/' + id;
        !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

        // Loop de Captura
        for (let i = 1; i < 32; i++) {
            const canRun = await page.evaluate(() => typeof window.moveCupPosition === 'function');
            if (canRun) {
                await page.addScriptTag({ content: `moveCupPosition(${i})` });
            }
            
            // Aumentei o sleep para 250ms. 
            // "GPU stall due to ReadPixels" significa que o print é LENTO. 
            // Se for rápido demais, encavala processos.
            await sleep(250); 

            await page.screenshot({
                type: 'png',
                path: `${dir}/${i}.png`,
                clip: { x: 0, y: 0, width, height },
                omitBackground: true
            });
        }

        await browser.close();
        browser = null;

        // --- GERAÇÃO DO GIF (MANTIDA) ---
        const filename = `gif-${id}.gif`;
        const gifPath = `${dir}/${filename}`;
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        const encoder = new GIFEncoder(width, height);
        
        encoder.createReadStream().pipe(fs.createWriteStream(gifPath));
        encoder.start();
        encoder.setRepeat(0);
        encoder.setDelay(100);
        encoder.setQuality(10); 

        const imagePaths = fs.readdirSync(dir).filter(n => n.includes('png'));
        imagePaths.sort((a, b) => parseInt(a) - parseInt(b));

        for(let loop = 0; loop < 3; loop++) {
             for(const imgPath of imagePaths) {
                 const img = await loadImage(path.join(dir, imgPath));
                 ctx.drawImage(img, 0, 0, width, height);
                 encoder.addFrame(ctx);
             }
        }
        encoder.finish();

        res.download(gifPath, filename, err => {
            if(!err) console.log(`GIF gerado com sucesso: ${id}`);
            rimraf(dir, () => { });
        });

    } catch (error) {
        console.error('ERRO:', error.message);
        if(browser) {
            try {
                // Tenta tirar print do erro se não for erro de protocolo
                if (!error.message.includes('Protocol')) {
                    const p = await browser.pages();
                    if(p[0]) await p[0].screenshot({ path: `erro-${id}.png` });
                }
            } catch(e) {}
            await browser.close();
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/generate-gif', async (req, res) => {
    const {
        url,
        project,
        width = 375,
        height = 667,
    } = req.body;

    console.log('generate-gif', { width, height, url, project });

    if (!url || !project) return res.status(403).json({
        status: false,
        message: "url or project is missing"
    });

    const initTime = newInitTime();

    const userDataDir = puppeteerDataDir('gif_data_' + project)

    let browser = null;

    try {
        browser = await puppeteer.launch({ ...puppeteer_launch_props, userDataDir });
        const page = await browser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        await page.goto(url);
        await page.waitForSelector('.three-loaded', { timeout: 0 });

        const dir = './uploads/' + initTime;

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

        // ---------------------------------------- \\

        const filename = `gif-${initTime}.gif`;
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
        }))();

        res.download(gifPath, filename, err => {
            err
                ? console.log(`Error downloading GIF`, { width, height, url, project }, err)
                : console.log(`GIF downloaded successfully in ${getResultTime(initTime)}`, { width, height, url, project });

            rimraf(dir, () => { });
        })
    } catch (error) {
        console.log(error)
        return res.sendStatus(403)
    } finally {
        if (browser) browser.close();
    }
})

app.post('/generate-pdf', async (req, res) => {
    const initTime = newInitTime();

    let browser = null;

    try {
        const reqOpts = req.body.options || {}
        const url = req.body.url
        const timeSleep = req.body?.sleep || 250

        const filename = `pdf-${new Date().getTime()}.pdf`
        const path = `./uploads/${filename}`

        const options = { path }

        isDefined(reqOpts.displayHeaderFooter) && (options['displayHeaderFooter'] = reqOpts.displayHeaderFooter);
        isDefined(reqOpts.footerTemplate) && (options['footerTemplate'] = reqOpts.footerTemplate);
        isDefined(reqOpts.format) && (options['format'] = reqOpts.format);
        isDefined(reqOpts.headerTemplate) && (options['headerTemplate'] = reqOpts.headerTemplate);
        isDefined(reqOpts.height) && (options['height'] = reqOpts.height);
        isDefined(reqOpts.landscape) && (options['landscape'] = reqOpts.landscape);
        isDefined(reqOpts.omitBackground) && (options['omitBackground'] = reqOpts.omitBackground);
        isDefined(reqOpts.pageRanges) && (options['pageRanges'] = reqOpts.pageRanges);
        isDefined(reqOpts.preferCSSPageSize) && (options['preferCSSPageSize'] = reqOpts.preferCSSPageSize);
        isDefined(reqOpts.printBackground) && (options['printBackground'] = reqOpts.printBackground);
        isDefined(reqOpts.scale) && (options['scale'] = reqOpts.scale);
        isDefined(reqOpts.timeout) && (options['timeout'] = reqOpts.timeout);
        isDefined(reqOpts.width) && (options['width'] = reqOpts.width);

        browser = await puppeteer.launch({ ...puppeteer_launch_props });

        const page = await browser.newPage();

        await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

        await sleep(timeSleep);

        await page.pdf(options);

        await browser.close();

        return res.download(path, filename, err => {
            const log = err ? ['Error downloading PDF', req.body, err] : [`PDF (${url}) Downloaded successfully in ${getResultTime(initTime)}`];

            console.log(...log);

            fs.unlink(path, _unlinkErr => { });
        })
    } catch (error) {
        return res.sendStatus(403)
    } finally {
        if (browser) browser.close();
    }
});

app.post('/logPedidos', async (req, res) => {
    try {
        const { data, origem, id_usuario, dataHora, id_pedido } = req.body;

        const logPedido = new PedidosModel({ data, origem, id_usuario, dataHora, id_pedido });

        await logPedido.save();
        res.status(201).json(logPedido);

        console.log('LOG: Pedido #' + id_pedido + ' registrado.');
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
});

app.post('/logFinanceiro', async (req, res) => {
    try {
        const { data, origem, id_usuario, dataHora, id_pedido, id } = req.body;

        const logFinanceiro = new FinanceiroModel({ data, origem, id_usuario, dataHora, id_pedido, id });

        await logFinanceiro.save();
        res.status(201).json(logFinanceiro);

        if (id_pedido) {
            console.log('LOG: Registro alterado no Financeiro - Pedido #' + id_pedido + '.');
        } else {
            console.log('LOG: Registro alterado no Financeiro - Registro com ID #' + id + '.');
        }
    } catch (error) {
        res.status(500).json({ error: error.message })
    }
});

app.post('/api/gerar-calco', async (req, res) => {
    try {
        const { url_arte, id_pedido, index, id_arte, webhook_url, modo_render } = req.body;

        if (!id_arte || !url_arte) {
            return res.status(400).json({
                status: false,
                message: 'Dados incompletos. Faltando id_arte ou url_arte.'
            });
        }

        console.log(`API: Iniciando geração direta para arte ${id_arte} | Modo: ${modo_render}`);

        const payload = {
            url_arte,
            id_arte,
            id_pedido,
            index,
            webhook_url,
            modo_render: modo_render || 'translucido_branco'
        };

        processarJobCalco(payload)
            .then(() => console.log(`Sucesso no processamento direto: ${id_arte}`))
            .catch(err => console.error(`Erro no processamento direto ${id_arte}:`, err));

        // Responde imediatamente
        return res.json({
            status: true,
            message: 'Processamento iniciado imediatamente (sem fila)'
        });

    } catch (error) {
        console.error('Erro no endpoint:', error);
        return res.status(500).json({ status: false, error: 'Erro interno' });
    }
});

app.listen(port, () => console.log(`Server running on port ${port}`));

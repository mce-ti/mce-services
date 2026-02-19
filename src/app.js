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
const db                            = require('./db');
const PedidosModel                  = require('./models/pedidosModel');
const FinanceiroModel               = require('./models/financeiroModel');
const { processarJobCalco }         = require('./processarJobCalco');

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

    console.log(`[${id}] generate-gif-by-order-id`, { id, product });

    const initTime = newInitTime();
    const uniqueDir = puppeteerDataDir(`gif_data_${id}`);
    let browser = null;

    try {
        // --- CONFIGURAÇÃO LIMPA (Igual Qero) ---
        browser = await puppeteer.launch({ 
            ...puppeteer_launch_props, 
            userDataDir: uniqueDir,
            headless: "new", // Mude para false se quiser ver abrindo
            protocolTimeout: 0, // Infinito (para não dar erro de protocolo)
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--hide-scrollbars',
                '--mute-audio'
            ]
        });

        const page = await browser.newPage();
        await page.setViewport({ width, height, deviceScaleFactor: 1 });

        console.log(`[${id}] Abrindo página do 3D...`);

        // Use networkidle0 pois você consertou o site, então ele deve carregar rápido
        await page.goto(`https://www.meucopoeco.com.br/site/customizer/${id}/${product}?origem=gif-service&t=${Date.now()}`, {
            waitUntil: 'domcontentloaded', 
            timeout: 60000
        });

        console.log(`[${id}] Página aberta!`);

        await page.waitForSelector('.three-loaded', { timeout: 30000 });
        
        // Pausa curta só para estabilizar visualmente
        await sleep(500);

        const dir = './uploads/' + id;
        !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });

        console.log(`[${id}] Iniciando screenshots...`);

        // --- LOOP OTIMIZADO ---
        for (let i = 1; i < 32; i++) {
            // Executa rotação
            await page.evaluate((index) => {
                if (typeof window.moveCupPosition === 'function') window.moveCupPosition(index);
            }, i);

            // 50ms é muito rápido. Se o GIF piscar, aumente para 100.
            await sleep(50); 

            await page.screenshot({
                type: 'png',
                path: `${dir}/${i}.png`,
                clip: { x: 0, y: 0, width, height },
                omitBackground: true
            });
            
            // Log a cada 10 frames para não poluir, mas mostrar progresso
            if (i % 10 === 0) console.log(`[${id}] Frame ${i}/31 capturado.`);
        }

        if (browser) await browser.close();
        browser = null;

        console.log(`[${id}] Iniciando geração do GIF...`);

        const filename = `gif-${id}.gif`;
        const gifPath = `${dir}/${filename}`;
        
        // --- CORREÇÃO: Esperar o arquivo ser escrito no disco ---
        await new Promise((resolve, reject) => {
            const encoder = new GIFEncoder(width, height);
            const stream = fs.createWriteStream(gifPath);
            
            // Conecta o encoder ao arquivo
            encoder.createReadStream().pipe(stream);
            
            encoder.start();
            encoder.setRepeat(0);
            encoder.setDelay(100);
            encoder.setQuality(1); // Qualidade rápida

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            const imagePaths = fs.readdirSync(dir).filter(n => n.includes('png'));
            // Ordenação numérica crucial
            imagePaths.sort((a, b) => parseInt(a) - parseInt(b));

            // Função assíncrona para desenhar os frames
            const processFrames = async () => {
                try {
                    // Loop de repetição (3x)
                    for(let loop = 0; loop < 3; loop++) {
                        for(const imgPath of imagePaths) {
                            const img = await loadImage(path.join(dir, imgPath));
                            ctx.drawImage(img, 0, 0, width, height);
                            encoder.addFrame(ctx);
                        }
                    }
                    
                    // Finaliza o encoder
                    encoder.finish(); 
                    // NÃO resolvemos aqui ainda, esperamos o stream fechar abaixo
                } catch (err) {
                    reject(err);
                }
            };

            // Eventos para garantir que o arquivo salvou
            stream.on('finish', () => {
                console.log(`[${id}] Arquivo GIF salvo no disco com sucesso.`);
                resolve();
            });
            
            stream.on('error', (err) => {
                console.error(`[${id}] Erro ao salvar arquivo GIF:`, err);
                reject(err);
            });

            // Começa o processamento
            processFrames();
        });
        
        res.download(gifPath, filename, err => {
            if(!err) console.log(`[${id}] Download concluído com sucesso em ${getResultTime(initTime)}`);
            else console.error(`[${id}] Erro no download:`, err);
            
            // Limpa a pasta temporária
            rimraf(dir, () => { });
        });

    } catch (error) {
        console.error(`ERRO FATAL [${id}]:`, error);
        if (browser) await browser.close();
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

    // Log inicial com ID do projeto
    console.log(`[${project}] generate-gif (Qero)`, { width, height, url });

    if (!url || !project) return res.status(403).json({
        status: false,
        message: "url or project is missing"
    });

    const initTime = newInitTime();
    // Garante pasta única
    const uniqueDir = puppeteerDataDir(`gif_data_${project}_${Date.now()}`);
    let browser = null;

    try {
        // --- CONFIGURAÇÃO ROBUSTA (Idêntica à MCE) ---
        browser = await puppeteer.launch({ 
            ...puppeteer_launch_props, 
            userDataDir: uniqueDir,
            headless: "new",
            protocolTimeout: 0, // Infinito para evitar timeout de protocolo em processos longos
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--hide-scrollbars',
                '--mute-audio'
            ]
        });

        const page = await browser.newPage();
        
        // Disfarce para evitar bloqueios de firewall
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        await page.setViewport({ width, height, deviceScaleFactor: 1 });
        
        console.log(`[${project}] Navegando...`);

        await page.goto(url, { 
            waitUntil: 'domcontentloaded', 
            timeout: 90000 
        });

        console.log(`[${project}] Esperando carregamento do 3D...`);

        // Tenta esperar pelo seletor padrão. Se falhar, segue o baile (caso o site da Qero use outro)
        try {
            await page.waitForSelector('.three-loaded', { timeout: 30000 });
        } catch(e) {
            console.log(`[${project}] Aviso: .three-loaded não apareceu, seguindo com espera fixa.`);
        }
        
        // Estabilização visual
        await sleep(500);

        const dir = './uploads/' + initTime;
        !fs.existsSync(dir) && fs.mkdirSync(dir, { recursive: true });
        
        console.log(`[${project}] Iniciando screenshots...`);

        // --- LOOP DE CAPTURA ---
        for (let i = 1; i < 32; i++) {
            await page.evaluate((index) => {
                if (typeof window.moveCupPosition === 'function') {
                    window.moveCupPosition(index);
                }
            }, i);

            // 100ms igual ao MCE
            await sleep(100);

            await page.screenshot({
                type: 'png',
                path: `${dir}/${i}.png`,
                clip: { x: 0, y: 0, width, height },
                omitBackground: true
            });

            // Log de progresso
            if (i % 10 === 0) console.log(`[${project}] Frame ${i}/31 capturado.`);
        }

        // Fecha o navegador antes de processar o GIF para economizar RAM
        if(browser) await browser.close();
        browser = null;

        console.log(`[${project}] Iniciando geração do GIF...`);

        // ---------------------------------------- \\

        const filename = `gif-${initTime}.gif`;
        const gifPath = `${dir}/${filename}`;

        // --- GERAÇÃO BLINDADA COM PROMISE (Igual MCE) ---
        await new Promise((resolve, reject) => {
            const encoder = new GIFEncoder(width, height);
            const stream = fs.createWriteStream(gifPath);
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            encoder.createReadStream().pipe(stream);
            
            encoder.start();
            encoder.setRepeat(0);
            encoder.setDelay(100);
            encoder.setQuality(1); // Qualidade 20 (Rápida e boa)

            const imagePaths = fs.readdirSync(dir).filter(name => name.includes('png'));
            imagePaths.sort((a, b) => parseInt(a) - parseInt(b));

            const processFrames = async () => {
                try {
                    // Loop de repetição (3x)
                    for(let loop = 0; loop < 3; loop++) {
                        for(const imgPath of imagePaths) {
                            const img = await loadImage(path.join(dir, imgPath));
                            ctx.drawImage(img, 0, 0, width, height);
                            encoder.addFrame(ctx);
                        }
                    }
                    encoder.finish();
                } catch (err) {
                    reject(err);
                }
            };

            // Eventos do Stream para garantir salvamento no disco
            stream.on('finish', () => {
                console.log(`[${project}] Arquivo GIF salvo no disco.`);
                resolve();
            });
            
            stream.on('error', (err) => {
                console.error(`[${project}] Erro stream GIF:`, err);
                reject(err);
            });

            processFrames();
        });

        console.log(`[${project}] Enviando download...`);

        res.download(gifPath, filename, err => {
            if (err) {
                console.error(`[${project}] Erro no download:`, err);
            } else {
                console.log(`[${project}] Sucesso! GIF gerado em ${getResultTime(initTime)}`);
            }

            rimraf(dir, () => { });
        });

    } catch (error) {
        console.error(`ERRO FATAL [${project}]:`, error);
        if(browser) await browser.close();
        return res.status(500).json({ error: error.message });
    }
});

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
    
        browser = await puppeteer.launch({ ...puppeteer_launch_props });
        
        const page = await browser.newPage();
        
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000});
        
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
        if(browser) browser.close();
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

        if(id_pedido) {
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
        const { url_arte, id_pedido, index, id_pedido_produto, id_arte, webhook_url, modo_render } = req.body;

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
            id_pedido_produto,
            webhook_url,
            modo_render: modo_render || 'translucido_branco'
        };
        
        processarJobCalco(payload)
            .then(() => console.log(`Sucesso no processamento direto: ${id_arte}`))
            .catch(err => console.error(`Erro no processamento direto ${id_arte}:`, err));

        // Responde imediatamente
        return res.json({
            status: true,
            message: 'Processamento iniciado imediatamente'
        });

    } catch (error) {
        console.error('Erro no endpoint:', error);
        return res.status(500).json({ status: false, error: 'Erro interno' });
    }
});

app.listen(port, () => console.log(`Server running on port ${port}`));

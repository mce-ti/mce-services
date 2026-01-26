const puppeteer = require('puppeteer');
const axios = require('axios');
const { puppeteer_launch_props } = require('./constants');

const processarJobCalco = async (data) => {

    const { url_arte, id_arte, id_pedido, index, webhook_url, modo_render } = data;

    console.log(`[Gerar Calço] Iniciando processamento: Arte ${id_arte} | Pedido ${id_pedido}`);

    let browser = null;

    try {
        browser = await puppeteer.launch({
            ...puppeteer_launch_props,
            args: [
                ...(puppeteer_launch_props.args || []),
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process',        // Economiza memória
                '--no-zygote'
            ]
        });

        const page = await browser.newPage();
        
        // Timeout aumentado para segurança
        page.setDefaultNavigationTimeout(60000);

        await page.setViewport({ width: 2500, height: 2500, deviceScaleFactor: 2 });
        
        await page.goto(url_arte, { waitUntil: 'networkidle0', timeout: 60000 });

        // -----------------------------------------------------------
        // 1. VERIFICAÇÃO DE VISIBILIDADE DO MEDIDOR (LÓGICA ORIGINAL)
        // -----------------------------------------------------------
        const deveExibirMedidor = await page.evaluate(() => {
            const medidorImg = document.querySelector('#medidor img');
            if (!medidorImg) return false;

            const style = window.getComputedStyle(medidorImg);
            return style.display !== 'none';
        });

        // -----------------------------------------------------------
        // 2. MONTAGEM DO CSS DO MEDIDOR
        // -----------------------------------------------------------
        let cssMedidor = '';

        if (deveExibirMedidor) {
            cssMedidor = `
                .template #medidor img {
                    display: block !important;
                    background: transparent !important;
                    filter: brightness(0) invert(1) drop-shadow(0 0 0 white) drop-shadow(0 0 0 white) drop-shadow(0 0 0 white) !important;
                    -webkit-filter: brightness(0) invert(1) drop-shadow(0 0 0 white) drop-shadow(0 0 0 white) drop-shadow(0 0 0 white) !important;
                    opacity: 1 !important;
                    mix-blend-mode: normal !important;
                }
                .template #medidor {
                    opacity: 1 !important;
                    background: transparent !important;
                    filter: none !important;
                }
            `;
        } else {
            cssMedidor = `
                .template #medidor, .template #medidor img {
                    display: none !important;
                }
            `;
        }

        // -----------------------------------------------------------
        // 3. CONFIGURAÇÃO DO FUNDO
        // -----------------------------------------------------------
        let cssBackground = '';
        let omitBackground = true;

        switch (modo_render) {
            case 'opaco':
                cssBackground = 'background-color: #000000 !important; background-image: none !important;';
                omitBackground = false; 
                break;
            case 'translucido_colorido':
                cssBackground = 'background-color: #FFFFFF !important; background-image: none !important;';
                omitBackground = false; 
                break;
            case 'translucido_branco':
            default:
                cssBackground = 'background-color: transparent !important; background-image: none !important;';
                omitBackground = true; 
                break;
        }

        // -----------------------------------------------------------
        // 4. INJEÇÃO DO CSS FINAL
        // -----------------------------------------------------------
        await page.addStyleTag({
            content: `
                body { margin: 0; padding: 0; background: transparent !important; }

                /* APLICA A REGRA DO MODO NO FUNDO */
                .template {
                    ${cssBackground}
                    box-shadow: none !important;
                    border: none !important;
                }

                /* ELEMENTOS GERAIS (ARTE) - SEMPRE PRETOS */
                .template div.elemento {
                    filter: brightness(0) grayscale(100%) !important;
                    -webkit-filter: brightness(0) grayscale(100%) !important;
                    color: #000 !important;
                    box-shadow: none !important;
                    border: none !important;
                    opacity: 1 !important;
                }

                ${cssMedidor}
            `
        });

        // Pausa leve para garantir renderização CSS
        await new Promise(r => setTimeout(r, 1000));

        const selector = '.template'; 
        await page.waitForSelector(selector, { timeout: 10000 });
        const element = await page.$(selector);

        if (!element) throw new Error(`Elemento ${selector} não encontrado!`);

        const imageBuffer = await element.screenshot({
            omitBackground: omitBackground,
            type: 'png'
        });

        console.log(`[Gerar Calço] Imagem gerada com sucesso para Arte ${id_arte}.`);

        if (webhook_url) {
            console.log(`[Gerar Calço] Enviando webhook...`);
            await axios.post(webhook_url, {
                id_arte: id_arte,
                id_pedido: id_pedido,
                index: index,
                imagem: imageBuffer.toString('base64'),
            });
            console.log(`[Gerar Calço] Webhook enviado.`);
        }

    } catch (error) {
        console.error(`[Gerar Calço] Erro Fatal na Arte ${id_arte}:`, error);
    } finally {
        if (browser) await browser.close();
    }
};

// Exporta a função para ser usada no app.js
module.exports = { processarJobCalco };
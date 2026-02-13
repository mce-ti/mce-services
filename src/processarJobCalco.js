const puppeteer = require('puppeteer');
const axios = require('axios');
const { puppeteer_launch_props } = require('./constants');

const processarJobCalco = async (data) => {

    const { url_arte, id_arte, id_pedido, index, id_pedido_produto, webhook_url, modo_render } = data;

    console.log(`[Gerar Calço] Iniciando processamento: Arte ${id_arte} | Pedido ${id_pedido}`);

    let browser = null;

    try {
        browser = await puppeteer.launch({
            ...puppeteer_launch_props,
            args: [
                ...(puppeteer_launch_props.args || []),
                '--disable-gpu'
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
                    filter: grayscale(1) contrast(150%) brightness(1.1);
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

        switch (modo_render) {
            case 'opaco':
                cssBackground = 'background-color: #000000 !important; background-image: none !important;';
                break;
            case 'translucido_colorido':
                cssBackground = 'background-color: #FFFFFF !important; background-image: none !important;';
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
            omitBackground: false,
            type: 'jpeg',
            quality: 80,
        });

        console.log(`[Gerar Calço] Imagem gerada com sucesso para Arte ${id_arte}.`);

        if (webhook_url) {
            console.log(`[Gerar Calço] Enviando webhook para: ${webhook_url}`);

            try {
                const response = await axios.post(webhook_url, {
                    id_arte: id_arte,
                    id_pedido: id_pedido,
                    index: index,
                    id_pedido_produto: id_pedido_produto,
                    imagem: imageBuffer.toString('base64'),
                }, {
                    maxBodyLength: Infinity,
                    maxContentLength: Infinity
                });

                console.log(`[Gerar Calço] SUCESSO! Status: ${response.status}`);
                console.log(`[Gerar Calço] Resposta do PHP:`, JSON.stringify(response.data));

            } catch (axiosError) {
                if (axiosError.response) {
                    console.error(`[Gerar Calço] ERRO NO SERVIDOR (PHP):`);
                    console.error(`Status Code: ${axiosError.response.status}`);
                    console.error(`Dados da Resposta:`, axiosError.response.data);
                    console.error(`Headers:`, axiosError.response.headers);
                } else if (axiosError.request) {
                    console.error(`[Gerar Calço] ERRO DE REDE: Sem resposta do servidor.`);
                    console.error(axiosError.request);
                } else {
                    console.error(`[Gerar Calço] ERRO DE CONFIGURAÇÃO AXIOS:`, axiosError.message);
                }
            }
        }

    } catch (error) {
        console.error(`[Gerar Calço] Erro Fatal na Arte ${id_arte}:`, error);
    } finally {
        if (browser) await browser.close();
    }
};

// Exporta a função para ser usada no app.js
module.exports = { processarJobCalco };
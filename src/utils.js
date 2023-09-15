const path = require('path');

const newInitTime = () => new Date().getTime();

const getResultTime = (initTime = 0) => ((new Date().getTime() - initTime) / 1000).toFixed(2) + 's';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const isDefined = value => typeof value !== 'undefined';

const puppeteerDataDir = (dir = '') => path.resolve(__dirname, `../user_data_dir/${dir}`);

module.exports = {
    newInitTime,
    getResultTime,
    sleep,
    isDefined,
    puppeteerDataDir
}
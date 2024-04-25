const mongoose = require('mongoose');

const mceUri = "mongodb+srv://Lucian:valdisere@mcecluster.8l3jf5c.mongodb.net/mce?retryWrites=true&w=majority&appName=mceCluster";

mongoose.connect(mceUri);

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'MoongoDB error connection'));

db.once('open', () => {
    console.log('Conected to MongoDB!');
});

module.exports = db;
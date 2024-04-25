const mongoose = require('mongoose');

const PedidosModelSchema = new mongoose.Schema({
    data: { type: mongoose.Schema.Types.Mixed, required: false },
    origem: { type: String, required: true },
    id_usuario: { type: Number, required: true },
    dataHora: { type: String, required: true },
});

const PedidosModel = mongoose.model('pedidos_logs', PedidosModelSchema);

module.exports = PedidosModel;
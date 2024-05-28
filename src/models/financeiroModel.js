const mongoose = require('mongoose');

const FinanceiroModelSchema = new mongoose.Schema({
    data: { type: mongoose.Schema.Types.Mixed, required: false },
    origem: { type: String, required: true },
    id_usuario: { type: Number, required: true },
    dataHora: { type: String, required: true },
    id_pedido: { type: Number, required: false },
    id: { type: Number, required: true },
});

const FinanceiroModel = mongoose.model('financeiro_logs', FinanceiroModelSchema);

module.exports = FinanceiroModel;
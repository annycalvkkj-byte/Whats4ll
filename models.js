const mongoose = require('mongoose');

// Esquema para Respostas Automáticas
const ReplySchema = new mongoose.Schema({
    keyword: String,
    response: String
});

// Esquema para salvar mensagens recebidas
const MessageSchema = new mongoose.Schema({
    from: String,
    content: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = {
    Reply: mongoose.model('Reply', ReplySchema),
    Message: mongoose.model('Message', MessageSchema)
};

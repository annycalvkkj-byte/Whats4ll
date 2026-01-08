require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, Browsers, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const pino = require("pino");
const fs = require("fs"); // Para limpar sessão se der erro
const { Reply, Message } = require("./models");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

mongoose.connect(process.env.MONGO_URI);

let sock;

async function startWA(num = null, res = null) {
    // Se já houver uma pasta de autenticação antiga e deu erro, limpamos ela para evitar conflito
    if (num && fs.existsSync('./auth_info')) {
        console.log("Limpando sessão anterior para nova tentativa...");
    }

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.ubuntu("Chrome"), // Voltando para Ubuntu que é o que o Render usa
        connectTimeoutMs: 100000, // 100 segundos (Paciência máxima)
        defaultQueryTimeoutMs: 0,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "open") {
            console.log("BOT CONECTADO!");
            io.emit("status", "connected");
        }

        if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log("Conexão fechada. Motivo:", reason);
            
            // Se o erro for 428 ou conexão fechada, não tentamos reconectar automático para não bloquear o IP
            if (reason !== DisconnectReason.loggedOut && !num) {
                setTimeout(() => startWA(), 5000);
            }
        }
    });

    // Se um número foi passado, pedimos o código
    if (num && res) {
        try {
            console.log("Aguardando estabilidade para gerar código...");
            await delay(15000); // ESPERA 15 SEGUNDOS para a conexão firmar
            
            const code = await sock.requestPairingCode(num);
            console.log("Código gerado com sucesso!");
            res.json({ code });
        } catch (err) {
            console.error("Erro ao gerar código:", err);
            res.status(500).json({ error: "O WhatsApp demorou a responder. Tente clicar no botão novamente agora." });
        }
    }

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;
        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
        const from = m.key.remoteJid;
        const msgDoc = await Message.create({ from, content: text });
        io.emit("new_message", msgDoc);
        const reply = await Reply.findOne({ keyword: text.toLowerCase().trim() });
        if (reply) await sock.sendMessage(from, { text: reply.response });
    });
}

app.get("/get-pairing-code", async (req, res) => {
    const num = req.query.number.replace(/[^0-9]/g, "");
    if (!num) return res.status(400).send("Número inválido");
    
    // Inicia a conexão DO ZERO para este pedido
    await startWA(num, res);
});

// Outras rotas permanecem iguais
app.post("/replies", async (req, res) => {
    await Reply.findOneAndUpdate({ keyword: req.body.keyword.toLowerCase() }, { response: req.body.response }, { upsert: true });
    res.send("Salvo!");
});

app.get("/load-data", async (req, res) => {
    const replies = await Reply.find();
    const messages = await Message.find().sort({ timestamp: -1 }).limit(10);
    res.json({ replies, messages });
});

// Não iniciamos o startWA() aqui no servidor, esperamos o botão ser clicado
server.listen(process.env.PORT || 3000, () => console.log("Servidor Online. Aguardando clique no site..."));

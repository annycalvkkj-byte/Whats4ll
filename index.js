require('dotenv').config();
const { default: makeWASocket, useMultiFileAuthState, Browsers, delay, DisconnectReason } = require("@whiskeysockets/baileys");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const pino = require("pino");
const { Reply, Message } = require("./models");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// Conexão Banco de Dados via .env
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Conectado!"))
    .catch(err => console.error("Erro MongoDB:", err));

let sock;

async function startWA() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop")
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startWA();
        }
        io.emit("status", connection);
    });

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const text = m.message.conversation || m.message.extendedTextMessage?.text || "";
        const from = m.key.remoteJid;

        // Salva e avisa o site
        const msgDoc = await Message.create({ from, content: text });
        io.emit("new_message", msgDoc);

        // Auto-resposta
        const reply = await Reply.findOne({ keyword: text.toLowerCase().trim() });
        if (reply) {
            await sock.sendMessage(from, { text: reply.response });
        }
    });
}

// Rota para Gerar Código de Pareamento
app.get("/get-pairing-code", async (req, res) => {
    const num = req.query.number.replace(/[^0-9]/g, "");
    if (!num) return res.status(400).send("Número inválido");
    
    try {
        await delay(2000);
        const code = await sock.requestPairingCode(num);
        res.json({ code });
    } catch (e) {
        res.status(500).json({ error: "Erro ao gerar código. Tente de novo." });
    }
});

// Rotas do Painel
app.post("/replies", async (req, res) => {
    await Reply.findOneAndUpdate(
        { keyword: req.body.keyword.toLowerCase() },
        { response: req.body.response },
        { upsert: true }
    );
    res.send("Salvo!");
});

app.get("/load-data", async (req, res) => {
    const replies = await Reply.find();
    const messages = await Message.find().sort({ timestamp: -1 }).limit(10);
    res.json({ replies, messages });
});

startWA();
server.listen(process.env.PORT || 3000, () => console.log("Servidor ON"));

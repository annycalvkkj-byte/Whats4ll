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

mongoose.connect(process.env.MONGO_URI);

let sock;

async function startWA() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        // MUDANÇA AQUI: Identidade de Chrome estável
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000, // Força o Render a não dormir
        emitOwnEvents: true
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("Tentando reconexão estável...");
                setTimeout(startWA, 5000);
            }
        }
        if (connection === "open") console.log("BOT CONECTADO COM SUCESSO!");
        io.emit("status", connection);
    });

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
    try {
        // Forçar um reinício do socket antes de pedir o código para garantir frescor
        if (sock) sock.logout(); 
        await delay(2000);
        await startWA();
        await delay(5000); // Espera o socket aquecer

        const code = await sock.requestPairingCode(num);
        res.json({ code });
    } catch (e) {
        console.log(e);
        res.status(500).json({ error: "Ocorreu um erro. Tente novamente em 10 segundos." });
    }
});

// Outras rotas (replies, load-data) continuam iguais...
app.post("/replies", async (req, res) => {
    await Reply.findOneAndUpdate({ keyword: req.body.keyword.toLowerCase() }, { response: req.body.response }, { upsert: true });
    res.send("Salvo!");
});

app.get("/load-data", async (req, res) => {
    const replies = await Reply.find();
    const messages = await Message.find().sort({ timestamp: -1 }).limit(10);
    res.json({ replies, messages });
});

startWA();
server.listen(process.env.PORT || 3000);

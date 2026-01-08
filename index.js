const { default: makeWASocket, useMultiFileAuthState, Browsers } = require("@whiskeysockets/baileys");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const mongoose = require("mongoose");
const { Reply, Message } = require("./models");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static('public'));

// Conecte ao seu MongoDB (Pegue o link no MongoDB Atlas)
mongoose.connect("SUA_URL_DO_MONGODB_AQUI");

let sock;

async function connectWA() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    sock = makeWASocket({
        auth: state,
        browser: Browsers.macOS("Desktop"),
        syncFullHistory: true
    });

    sock.ev.on("creds.update", saveCreds);

    // ESCUTANDO MENSAGENS
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const text = m.message.conversation || m.message.extendedTextMessage?.text;
        const from = m.key.remoteJid;

        // 1. Salva no banco de dados
        await Message.create({ from, content: text });

        // 2. Envia para o painel do site via Socket.io
        io.emit("new_message", { from, text });

        // 3. Lógica de Auto-Resposta
        const autoReply = await Reply.findOne({ keyword: text.toLowerCase() });
        if (autoReply) {
            await sock.sendMessage(from, { text: autoReply.response });
        }
    });
}

// Rota para salvar nova configuração de mensagem automática pelo site
app.post("/add-keyword", async (req, res) => {
    const { keyword, response } = req.body;
    await Reply.create({ keyword: keyword.toLowerCase(), response });
    res.send("Configuração salva!");
});

// Rota para ver as mensagens salvas
app.get("/messages", async (req, res) => {
    const msgs = await Message.find().sort({ timestamp: -1 }).limit(20);
    res.json(msgs);
});

server.listen(3000, () => {
    connectWA();
    console.log("Servidor e Bot ativos!");
});

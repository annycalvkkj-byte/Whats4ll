const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason 
} = require("@whiskeysockets/baileys");
const express = require("express");
const path = require("path");
const pino = require("pino");
const fs = require("fs");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

async function connectToWhatsApp(phoneNumber, res) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" })
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Conexão fechada. Reconectando:", shouldReconnect);
        } else if (connection === "open") {
            console.log("Bot Conectado!");
        }
    });

    // Se não estiver registrado, solicita o código
    if (!sock.authState.creds.registered) {
        if (!phoneNumber) {
            return res.status(400).json({ error: "Número não fornecido" });
        }

        try {
            await delay(3000); // Espera o socket inicializar
            const code = await sock.requestPairingCode(phoneNumber);
            res.json({ code });
        } catch (error) {
            console.error(error);
            res.status(500).json({ error: "Erro ao gerar código" });
        }
    } else {
        res.json({ message: "O bot já está conectado!" });
    }
}

// Rota para o Frontend pedir o código
app.get("/get-code", async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Número é obrigatório" });
    await connectToWhatsApp(num.replace(/[^0-9]/g, ""), res);
});

// Rota para responder mensagens (Teste)
// sock.ev.on("messages.upsert", async m => { ... }); 

app.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`);
});

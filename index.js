const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason,
    Browsers 
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

let sock; // Socket global para manter a conexão viva

async function startWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop"), // Mudamos para MacOS para testar outra assinatura
        connectTimeoutMs: 60000, // Aumentamos o tempo limite
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === "close") {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Conexão caiu. Tentando reabrir em 5s...");
            setTimeout(startWhatsApp, 5000);
        } else if (connection === "open") {
            console.log("=== BOT ONLINE E PRONTO ===");
        }
    });

    return sock;
}

// Inicia o bot assim que o servidor ligar
startWhatsApp();

app.get("/get-code", async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Número faltando" });
    const cleanNumber = num.replace(/[^0-9]/g, "");

    try {
        // Se o socket não existir ou estiver fechado, tenta reiniciar
        if (!sock) await startWhatsApp();
        
        console.log(`Solicitando código para: ${cleanNumber}`);
        
        // Pequena espera para garantir que o socket processou o comando
        await delay(3000);
        
        const code = await sock.requestPairingCode(cleanNumber);
        res.json({ code });
    } catch (error) {
        console.error("Erro detalhado:", error);
        res.status(500).json({ 
            error: "O WhatsApp recusou a conexão momentaneamente.",
            details: "Aguarde 15 segundos e clique no botão novamente sem recarregar a página." 
        });
    }
});

app.listen(port, () => {
    console.log(`Servidor rodando na porta ${port}`);
});

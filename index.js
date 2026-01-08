const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    DisconnectReason,
    Browsers // Importante adicionar isso
} = require("@whiskeysockets/baileys");
const express = require("express");
const pino = require("pino");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.static('public'));

async function connectToWhatsApp(phoneNumber, res) {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: "silent" }),
        // ESSA LINHA ABAIXO É ESSENCIAL PARA EVITAR O ERRO 428
        browser: Browsers.ubuntu("Chrome"), 
        syncFullHistory: false
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect } = update;
        
        if (connection === "close") {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("Conexão fechada. Tentando reconectar...", shouldReconnect);
            // Se der erro, não fazemos nada aqui para não bugar a resposta do site
        }
    });

    // Espera o socket estabilizar antes de pedir o código
    if (!sock.authState.creds.registered) {
        try {
            // Aumentamos o delay para 6 segundos para dar tempo do servidor estabilizar
            await delay(6000); 
            
            const code = await sock.requestPairingCode(phoneNumber);
            if (!res.headersSent) {
                res.json({ code });
            }
        } catch (error) {
            console.error("Erro ao gerar código:", error);
            if (!res.headersSent) {
                res.status(500).json({ error: "O servidor fechou a conexão. Tente clicar no botão novamente em 10 segundos." });
            }
        }
    } else {
        if (!res.headersSent) {
            res.json({ message: "O bot já está conectado!" });
        }
    }
}

app.get("/get-code", async (req, res) => {
    const num = req.query.number;
    if (!num) return res.status(400).json({ error: "Número é obrigatório" });
    
    // Remove caracteres especiais e espaços
    const cleanNumber = num.replace(/[^0-9]/g, "");
    await connectToWhatsApp(cleanNumber, res);
});

app.listen(port, () => {
    console.log(`Servidor online na porta ${port}`);
});

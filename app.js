// 1. Configurações da Nave Mãe (Reaproveitadas do teu Android)
const NOME_UTILIZADOR = "HUGO"; // <-- MUDA PARA O NOME DELE AQUI!
const MQTT_SERVER = "wss://ccda2dcf90d844ba96a090dd38cc8f58.s1.eu.hivemq.cloud:8884/mqtt";
const MQTT_USER = "hivemq.webclient.1771795370721";

// 🔐 O TRUQUE DO COFRE: Vai procurar a password à memória do iPhone
let MQTT_PASS = localStorage.getItem("vsync_secret_pass");

// Se for a primeira vez que ele abre a app, pede a password!
if (!MQTT_PASS) {
    MQTT_PASS = prompt("🔒 Bem-vindo ao VSync! Qual é a password da Família?");
    if (MQTT_PASS) {
        localStorage.setItem("vsync_secret_pass", MQTT_PASS);
    } else {
        alert("Precisas da password para usar a App!");
    }
}

// Gera um ID único para a sessão Web dele
const clientId = 'VSyncWeb-' + Math.random().toString(16).substr(2, 8);

const statusText = document.getElementById('statusText');

// 2. Ligar ao HiveMQ via WebSockets
const options = {
    clientId: clientId,
    username: MQTT_USER,
    password: MQTT_PASS,
    clean: true,
    reconnectPeriod: 5000 // Tenta religar a cada 5 segundos se falhar
};

const client = mqtt.connect(MQTT_SERVER, options);

client.on('connect', function () {
    statusText.innerText = "Conectado ao Serviço!";
    statusText.style.color = "#81C784"; // Verde
    
    // Subscrever ao ACK para saber se a mãe recebeu
    client.subscribe('familia/ack');
});

client.on('message', function (topic, message) {
    if (topic === 'familia/ack') {
        const payload = message.toString();
        if (payload.toUpperCase() === NOME_UTILIZADOR.toUpperCase()) {
            alert("Atualizado no Ecrã da Mãe! ✅");
        }
    }
});

client.on('offline', function () {
    statusText.innerText = "Desconectado do serviço!";
    statusText.style.color = "#E53935"; // Vermelho
});

// 3. Função Principal: Enviar Estado + GPS
async function enviarEstado(emoji, nomeEstado, corHex) {
    if (!client.connected) {
        alert("Sem ligação à internet!");
        return;
    }

    statusText.innerText = "A obter GPS...";
    statusText.style.color = "#FFB300"; // Amarelo

    // Pede o GPS ao browser do iPhone
    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Traduz coordenadas para nome da cidade (Reverse Geocoding gratuito)
            let locName = "Desconhecido";
            try {
                const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
                const data = await response.json();
                locName = data.address.city || data.address.town || data.address.village || "Localização obtida";
            } catch (error) {
                console.log("Erro a traduzir GPS", error);
                locName = "Sinal GPS Fraco";
            }

            // Constrói a mensagem tal como no Android: "Estudar|#388E3C|Lisboa"
            const payload = `${nomeEstado}|${corHex}|${locName}`;
            
            // Publica no tópico exato do irmão
            client.publish(`familia/status/${NOME_UTILIZADOR}`, payload, { qos: 0 });
            
            statusText.innerText = "Mensagem Enviada! À espera da Mãe...";
        },
        (error) => {
            // Se ele recusar o GPS ou falhar
            const payload = `${nomeEstado}|${corHex}|Sem Permissão GPS`;
            client.publish(`familia/status/${NOME_UTILIZADOR}`, payload, { qos: 0 });
            statusText.innerText = "Enviado (Sem GPS)";
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
}
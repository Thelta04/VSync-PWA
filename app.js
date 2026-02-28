// 1. Configurações da Nave Mãe
const NOME_UTILIZADOR = "HUGO"; // O nome do teu irmão
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

// --- GESTÃO DE ZONAS E MAPAS ---
let ZONAS_CONHECIDAS = JSON.parse(localStorage.getItem('vsync_zonas')) || [];
let mapaLeaflet = null;
let marcadorAtual = null;
let circuloAtual = null;

// --- FÓRMULA MATEMÁTICA (HAVERSINE) ---
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

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
    client.subscribe('familia/ack');
});

client.on('message', function (topic, message) {
    const payload = message.toString().toUpperCase();
    
    if (topic === 'familia/ack') {
        if (payload === NOME_UTILIZADOR.toUpperCase()) {
            alert("Atualizado no Ecrã da Mãe! ✅");
        }
    } 
    else if (topic === 'familia/mae/kiss') {
        if (payload === NOME_UTILIZADOR.toUpperCase()) {
            alert("A Mãe mandou-te um beijinho! 😘");
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]); 
            
            // ✨ ENVIA O RECIBO DE LEITURA (ACK) PARA A MÃE
            client.publish('familia/kiss/ack', NOME_UTILIZADOR, { qos: 1 });
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
            
            let locName = null;

            // 1. VERIFICA AS ZONAS CONHECIDAS PRIMEIRO (O teu Radar Local)
            for (const zona of ZONAS_CONHECIDAS) {
                const distancia = calcularDistancia(lat, lon, zona.lat, zona.lon);
                if (distancia <= zona.raio) {
                    locName = zona.nome; // Está dentro da zona!
                    break; // Pára de procurar
                }
            }
            
            // 2. SE NÃO ESTIVER EM NENHUMA ZONA, PROCURA A CIDADE
            if (!locName) {
                try {
                    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
                    const data = await response.json();
                    locName = data.address.city || data.address.town || data.address.village || "Localização obtida";
                } catch (error) {
                    console.log("Erro a traduzir GPS", error);
                    locName = "Sinal GPS Fraco";
                }
            }

            // Constrói a mensagem
            const payload = `${nomeEstado}|${corHex}|${locName}`;
            
            // Publica no tópico exato do irmão
            client.publish(`familia/status/${NOME_UTILIZADOR}`, payload, { qos: 0 });
            
            statusText.innerText = "Mensagem Enviada! À espera da Mãe...";
        },
        (error) => {
            const payload = `${nomeEstado}|${corHex}|Sem Permissão GPS`;
            client.publish(`familia/status/${NOME_UTILIZADOR}`, payload, { qos: 0 });
            statusText.innerText = "Enviado (Sem GPS)";
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
} // <--- ESTA ERA A CHAVETA QUE FALTAVA!

// --- LÓGICA DO MAPA VISUAL ---
function toggleMapa() {
    const painel = document.getElementById('painelMapa');
    if (painel.style.display === 'none') {
        painel.style.display = 'block';
        atualizarListaVisual();
        
        // Se o mapa ainda não existir, cria-o!
        if (!mapaLeaflet) {
            // Inicia em Lisboa por defeito
            mapaLeaflet = L.map('mapa').setView([38.7223, -9.1393], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap'
            }).addTo(mapaLeaflet);

            // Quando ele clica no mapa
            mapaLeaflet.on('click', function(e) {
                if (marcadorAtual) mapaLeaflet.removeLayer(marcadorAtual);
                if (circuloAtual) mapaLeaflet.removeLayer(circuloAtual);
                
                marcadorAtual = L.marker(e.latlng).addTo(mapaLeaflet);
                const raio = parseInt(document.getElementById('raioZona').value) || 150;
                
                // Desenha o círculo vermelho translúcido estilo VSync
                circuloAtual = L.circle(e.latlng, {
                    color: '#E53935',
                    fillColor: '#E53935',
                    fillOpacity: 0.2,
                    radius: raio
                }).addTo(mapaLeaflet);
            });
            
            // Tenta centrar no GPS atual dele para facilitar
            navigator.geolocation.getCurrentPosition(pos => {
                mapaLeaflet.setView([pos.coords.latitude, pos.coords.longitude], 15);
            });
        }
        
        // Corrige um bug visual comum do Leaflet em painéis escondidos
        setTimeout(() => mapaLeaflet.invalidateSize(), 100);
    } else {
        painel.style.display = 'none';
    }
}

function atualizarRaio() {
    if (circuloAtual) {
        const raio = parseInt(document.getElementById('raioZona').value) || 150;
        circuloAtual.setRadius(raio);
    }
}

function guardarZona() {
    const nome = document.getElementById('nomeZona').value.trim();
    const raio = parseInt(document.getElementById('raioZona').value);
    
    if (!marcadorAtual || nome === "") {
        alert("Por favor, clica no mapa e dá um nome à zona!");
        return;
    }

    const novaZona = {
        nome: nome,
        lat: marcadorAtual.getLatLng().lat,
        lon: marcadorAtual.getLatLng().lng,
        raio: raio
    };

    ZONAS_CONHECIDAS.push(novaZona);
    localStorage.setItem('vsync_zonas', JSON.stringify(ZONAS_CONHECIDAS)); // Guarda no cofre!
    
    document.getElementById('nomeZona').value = "";
    alert(`Zona '${nome}' guardada com sucesso!`);
    atualizarListaVisual();
}

function atualizarListaVisual() {
    const div = document.getElementById('listaZonasSalvas');
    if (ZONAS_CONHECIDAS.length === 0) {
        div.innerHTML = "<i>Nenhuma zona guardada.</i>";
        return;
    }
    
    let html = "<b>As tuas Zonas:</b><br>";
    ZONAS_CONHECIDAS.forEach((z, index) => {
        html += `📍 ${z.nome} (${z.raio}m) <button onclick="apagarZona(${index})" style="background:transparent; border:none; color:red; float:right;">X</button><br>`;
    });
    div.innerHTML = html;
}

function apagarZona(index) {
    if(confirm("Queres apagar esta zona?")) {
        ZONAS_CONHECIDAS.splice(index, 1);
        localStorage.setItem('vsync_zonas', JSON.stringify(ZONAS_CONHECIDAS));
        atualizarListaVisual();
    }
}

// ==========================================
// --- GESTÃO DE ESTADOS PERSONALIZADOS ---
// ==========================================

// 1. Estados base que vêm por defeito
const ESTADOS_DEFAULT = [
    { emoji: '🛋️', nome: 'Relaxar', cor: '#F57C00' },
    { emoji: '📚', nome: 'Estudar', cor: '#388E3C' },
    { emoji: '🍳', nome: 'Cozinhar', cor: '#1976D2' }
];

// 2. Carrega os estados customizados do Cofre do iPhone
let ESTADOS_CUSTOM = JSON.parse(localStorage.getItem('vsync_estados_custom')) || [];

// 3. Função para desenhar os botões no ecrã
function renderizarBotoesEstados() {
    const container = document.getElementById('listaBotoes');
    container.innerHTML = ""; // Limpa os botões antigos

    // Junta os default com os customizados
    const todosEstados = [...ESTADOS_DEFAULT, ...ESTADOS_CUSTOM];

    todosEstados.forEach((estado, index) => {
        // Verifica se é um estado customizado (para podermos mostrar o botão de apagar)
        const isCustom = index >= ESTADOS_DEFAULT.length;
        const customIndex = index - ESTADOS_DEFAULT.length;

        // Cria o código HTML do botão
        let btnHtml = `<button class="btn-estado" style="background-color: ${estado.cor}; position: relative;" onclick="enviarEstado('${estado.emoji}', '${estado.nome}', '${estado.cor}')">
            ${estado.emoji}   ${estado.nome}`;
            
        // Se for customizado, adiciona um pequeno X (caixote do lixo) à direita
        if (isCustom) {
            btnHtml += `<span onclick="event.stopPropagation(); apagarEstado(${customIndex})" style="position: absolute; right: 20px; top: 50%; transform: translateY(-50%); font-size: 14px; opacity: 0.7;">🗑️</span>`;
        }

        btnHtml += `</button>`;
        container.innerHTML += btnHtml;
    });
}

// 4. Lógica do Menu de Criar Estado
function togglePainelEstado() {
    const painel = document.getElementById('painelEstado');
    painel.style.display = painel.style.display === 'none' ? 'block' : 'none';
}

// 5. Função de Guardar Novo Estado
function guardarNovoEstado() {
    const emoji = document.getElementById('emojiInput').value.trim() || '📍';
    const nome = document.getElementById('nomeEstadoInput').value.trim();
    const cor = document.getElementById('corInput').value;

    if (nome === "") {
        alert("Por favor, dá um nome ao estado!");
        return;
    }

    const novoEstado = { emoji: emoji, nome: nome, cor: cor };
    ESTADOS_CUSTOM.push(novoEstado);
    
    // Guarda no Cofre
    localStorage.setItem('vsync_estados_custom', JSON.stringify(ESTADOS_CUSTOM));

    // Limpa o formulário e atualiza a interface
    document.getElementById('emojiInput').value = "";
    document.getElementById('nomeEstadoInput').value = "";
    togglePainelEstado(); // Esconde o painel
    renderizarBotoesEstados(); // Redesenha os botões
}

// 6. Função para apagar um estado customizado
function apagarEstado(index) {
    if(confirm("Queres apagar este estado?")) {
        ESTADOS_CUSTOM.splice(index, 1);
        localStorage.setItem('vsync_estados_custom', JSON.stringify(ESTADOS_CUSTOM));
        renderizarBotoesEstados();
    }
}

// ✨ ACIONADOR INICIAL: Desenha os botões assim que a app abre!
renderizarBotoesEstados();
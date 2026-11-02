// Descoberta automática na rede local: os outros computadores perguntam "tem Operatto aí?"
// e o caixa principal responde com o nome do restaurante e a porta.
const dgram = require("node:dgram");
const os = require("node:os");

const PORTA_DESCOBERTA = 8786;
const PERGUNTA = "OPERATTO?";

// Servidor (caixa principal): responde às perguntas.
function responderDescoberta({ porta, nome, versao }) {
  const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
  socket.on("message", (mensagem, origem) => {
    if (mensagem.toString() !== PERGUNTA) return;
    const resposta = Buffer.from(JSON.stringify({ operatto: true, porta, nome: nome(), versao }));
    socket.send(resposta, origem.port, origem.address);
  });
  socket.on("error", () => socket.close()); // porta ocupada: a descoberta fica desligada, o resto funciona
  socket.bind(PORTA_DESCOBERTA);
  return () => { try { socket.close(); } catch { /* já fechado */ } };
}

// Endereços de broadcast de cada rede (ex.: 192.168.3.255).
function enderecosBroadcast() {
  const lista = new Set(["255.255.255.255"]);
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const item of interfaces || []) {
      if (item.family !== "IPv4" || item.internal) continue;
      const ip = item.address.split(".").map(Number);
      const mascara = item.netmask.split(".").map(Number);
      lista.add(ip.map((parte, i) => (parte & mascara[i]) | (~mascara[i] & 255)).join("."));
    }
  }
  return [...lista];
}

// Outro computador: pergunta na rede e junta as respostas por alguns instantes.
function procurarServidores(tempo = 1800) {
  return new Promise((resolve) => {
    const encontrados = new Map();
    const socket = dgram.createSocket("udp4");
    socket.on("message", (mensagem, origem) => {
      try {
        const dados = JSON.parse(mensagem.toString());
        if (dados.operatto) encontrados.set(origem.address, { ip: origem.address, porta: dados.porta, nome: dados.nome, versao: dados.versao, endereco: `http://${origem.address}:${dados.porta}` });
      } catch { /* resposta de outro programa */ }
    });
    socket.on("error", () => resolve([...encontrados.values()]));
    socket.bind(0, () => {
      socket.setBroadcast(true);
      const pergunta = Buffer.from(PERGUNTA);
      for (const destino of enderecosBroadcast()) socket.send(pergunta, PORTA_DESCOBERTA, destino, () => {});
    });
    setTimeout(() => {
      try { socket.close(); } catch { /* já fechado */ }
      resolve([...encontrados.values()]);
    }, tempo);
  });
}

module.exports = { responderDescoberta, procurarServidores, PORTA_DESCOBERTA };

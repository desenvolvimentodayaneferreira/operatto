// Monta o servidor do Operatto: banco de dados, rotas, cópias de segurança e endereço na rede local.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { abrir } = require("./banco");
const { criarServidor } = require("./http");
const { criarAcesso } = require("./acesso");
const { criarCardapio } = require("./cardapio");
const { criarPedidos } = require("./pedidos");
const { criarCaixa } = require("./caixa");
const { prepararExemplo } = require("./exemplo");
const { responderDescoberta } = require("./descoberta");

const VERSAO = require("../package.json").version;
const BACKUPS_MANTIDOS = 60;

// Endereços IPv4 da rede local (Wi-Fi/cabo), para os celulares se conectarem.
function enderecosLocais() {
  return Object.entries(os.networkInterfaces())
    .flatMap(([nome, lista]) => (lista || []).map((item) => ({ nome, ...item })))
    .filter((item) => item.family === "IPv4" && !item.internal && !/^169\.254\./.test(item.address))
    .filter((item) => !/vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Bluetooth/i.test(item.nome)) // adaptadores virtuais
    .sort((a, b) => Number(/^192\.168\./.test(b.address)) - Number(/^192\.168\./.test(a.address)))
    .map((item) => ({ interface: item.nome, ip: item.address }));
}

function copiaDiaria(banco, pastaBackups) {
  fs.mkdirSync(pastaBackups, { recursive: true });
  const hoje = new Date().toISOString().slice(0, 10);
  const destino = path.join(pastaBackups, `operatto-${hoje}.db`);
  if (!fs.existsSync(destino)) banco.copiar(destino);
  const antigas = fs.readdirSync(pastaBackups).filter((nome) => /^operatto-\d{4}-\d{2}-\d{2}\.db$/.test(nome)).sort();
  antigas.slice(0, Math.max(0, antigas.length - BACKUPS_MANTIDOS)).forEach((nome) => fs.unlinkSync(path.join(pastaBackups, nome)));
  return destino;
}

function iniciarServidor({ pastaDados, porta = 8787, host = "0.0.0.0", exemplo = true, descoberta = true }) {
  fs.mkdirSync(pastaDados, { recursive: true });
  const banco = abrir(path.join(pastaDados, "operatto.db"));
  if (exemplo) prepararExemplo(banco);

  const acesso = criarAcesso(banco);
  const { servidor, rota, avisar, conectados } = criarServidor({ pastaWeb: path.join(__dirname, "..", "web"), autenticar: acesso.autenticar });
  const pedidos = criarPedidos(banco, avisar);

  acesso.rotas(rota);
  criarCardapio(banco, avisar).rotas(rota);
  pedidos.rotas(rota);
  criarCaixa(banco, avisar, pedidos).rotas(rota);

  rota("GET", "/api/sistema", ({ sessao }) => ({
    versao: VERSAO,
    porta: servidor.address()?.port,
    enderecos: enderecosLocais(),
    conectados: sessao.usuario.papel === "gerente" ? conectados() : undefined,
    cardapioExemplo: banco.config("cardapio_exemplo", false),
    taxaServicoPct: banco.config("taxa_servico_pct", 100),
  }));

  rota("PUT", "/api/sistema/config", { papeis: ["gerente"] }, ({ corpo }) => {
    if (corpo.taxa_servico_pct !== undefined) banco.salvarConfig("taxa_servico_pct", Math.max(0, Math.min(200, Number(corpo.taxa_servico_pct) || 0)));
    if (corpo.cardapio_exemplo === false) banco.salvarConfig("cardapio_exemplo", false);
    if (corpo.restaurante) banco.salvarConfig("restaurante", { nome: String(corpo.restaurante).trim() });
  });

  const pastaBackups = path.join(pastaDados, "backups");
  copiaDiaria(banco, pastaBackups);
  const temporizador = setInterval(() => copiaDiaria(banco, pastaBackups), 60 * 60 * 1000);

  let pararDescoberta = () => {};
  const pronto = new Promise((resolve, reject) => {
    servidor.once("error", reject);
    servidor.listen(porta, host, () => {
      const portaReal = servidor.address().port;
      // Outros computadores do restaurante encontram este caixa sozinhos.
      if (descoberta) pararDescoberta = responderDescoberta({ porta: portaReal, versao: VERSAO, nome: () => banco.config("restaurante", { nome: "Operatto" }).nome });
      resolve(portaReal);
    });
  });

  return {
    pronto,
    banco,
    avisar,
    enderecos: enderecosLocais,
    copiarAgora: () => copiaDiaria(banco, pastaBackups),
    async parar() {
      clearInterval(temporizador);
      pararDescoberta();
      await new Promise((resolve) => { servidor.closeAllConnections?.(); servidor.close(resolve); });
      banco.fechar();
    },
  };
}

module.exports = { iniciarServidor, enderecosLocais };

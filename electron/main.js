// Programa Operatto para computadores. Dois modos, escolhidos na primeira abertura:
// - caixa principal: liga o servidor local (dados + atendimento dos aparelhos) e abre a tela;
// - outro computador: encontra o caixa principal na rede e abre a tela dele.
const { app, BrowserWindow, dialog, shell, powerSaveBlocker, ipcMain, Menu } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { iniciarServidor } = require("../servidor/app");
const { procurarServidores } = require("../servidor/descoberta");

const AUTOTESTE = process.env.OPERATTO_AUTOTESTE;
if (AUTOTESTE) app.setPath("userData", path.join(app.getPath("temp"), "operatto-autoteste"));

const PORTAS = [8787, 8788, 8789, 8790];
const arquivoConfig = () => path.join(app.getPath("userData"), "computador.json");
let janela = null;
let servidor = null;
let porta = null;
let saindo = false;
let config = {};

function lerConfig() {
  if (AUTOTESTE) return { modo: process.env.OPERATTO_MODO || "servidor", servidor: process.env.OPERATTO_SERVIDOR };
  try { return JSON.parse(fs.readFileSync(arquivoConfig(), "utf8")); } catch { return {}; }
}
function salvarConfig(novo) {
  config = novo;
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(arquivoConfig(), JSON.stringify(novo, null, 2));
}

// ---------- Caixa principal ----------

async function ligarServidor() {
  const pastaDados = path.join(app.getPath("userData"), "dados");
  for (const tentativa of PORTAS) {
    try {
      servidor = iniciarServidor({ pastaDados, porta: tentativa });
      porta = await servidor.pronto;
      return;
    } catch (erro) {
      await servidor?.parar().catch(() => {});
      servidor = null;
      if (erro.code !== "EADDRINUSE") throw erro;
    }
  }
  throw new Error("As portas 8787 a 8790 estão ocupadas por outro programa.");
}

// ---------- Outro computador ----------

async function servidorResponde(endereco) {
  try {
    const resposta = await fetch(`${endereco}/api/estado`, { signal: AbortSignal.timeout(4000) });
    const dados = await resposta.json();
    return resposta.ok && dados.restaurante ? dados : null;
  } catch {
    return null;
  }
}

// Se o caixa principal mudou de endereço (roteador trocou o IP), procura de novo pelo nome.
async function reencontrarServidor() {
  const encontrados = await procurarServidores();
  const mesmo = encontrados.find((s) => s.nome === config.nome) || (encontrados.length === 1 ? encontrados[0] : null);
  if (mesmo) salvarConfig({ ...config, servidor: mesmo.endereco, nome: mesmo.nome });
  return mesmo;
}

async function abrirTerminal() {
  if (await servidorResponde(config.servidor) || (await reencontrarServidor())) {
    janela.loadURL(`${config.servidor}/`);
  } else {
    janela.loadFile(path.join(__dirname, "inicio", "sem-servidor.html"));
  }
}

// ---------- Janelas ----------

function criarJanela() {
  janela = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    title: "Operatto",
    backgroundColor: "#0c0b0e",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload-inicio.js") },
  });
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  janela.once("ready-to-show", () => {
    janela.maximize();
    janela.show();
  });
  janela.on("close", (evento) => {
    if (saindo || AUTOTESTE || config.modo !== "servidor") return;
    // Fechar o caixa principal desliga os celulares e a cozinha: confirma antes.
    const escolha = dialog.showMessageBoxSync(janela, {
      type: "warning",
      buttons: ["Continuar aberto", "Fechar o Operatto"],
      defaultId: 0,
      cancelId: 0,
      title: "Fechar o Operatto?",
      message: "Fechar o Operatto?",
      detail: "Este computador é o caixa principal do restaurante. Ao fechar, os celulares dos garçons, a tela da cozinha e os outros computadores param de funcionar até ele ser aberto de novo.",
    });
    if (escolha === 0) evento.preventDefault();
    else saindo = true;
  });
  // Outro computador perdeu o caixa principal no meio do uso: tenta reencontrar.
  janela.webContents.on("did-fail-load", (_e, codigo, _d, url) => {
    if (config.modo === "terminal" && codigo !== -3 && url.startsWith("http")) setTimeout(abrirTerminal, 3000);
  });
}

async function iniciar() {
  config = lerConfig();
  criarMenu();
  if (!janela) criarJanela();
  if (!config.modo) return janela.loadFile(path.join(__dirname, "inicio", "index.html"));
  if (config.modo === "servidor") {
    try {
      if (!servidor) await ligarServidor();
    } catch (erro) {
      dialog.showErrorBox("Operatto não pôde iniciar", erro.message);
      app.quit();
      return;
    }
    powerSaveBlocker.start("prevent-app-suspension"); // o caixa principal não pode "dormir" durante o expediente
    await janela.loadURL(`http://127.0.0.1:${porta}/`);
  } else {
    await abrirTerminal();
  }
  if (AUTOTESTE) autoteste();
}

function criarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "Operatto",
      submenu: [
        { label: "Recarregar", accelerator: "F5", click: () => janela?.webContents.reload() },
        { label: "Tela cheia", accelerator: "F11", click: () => janela?.setFullScreen(!janela.isFullScreen()) },
        { type: "separator" },
        { label: "Trocar o modo deste computador…", click: trocarModo },
        { type: "separator" },
        { label: "Sair", role: "quit" },
      ],
    },
  ]));
}

async function trocarModo() {
  const escolha = dialog.showMessageBoxSync(janela, {
    type: "question",
    buttons: ["Cancelar", "Trocar"],
    defaultId: 0,
    cancelId: 0,
    message: "Trocar o modo deste computador?",
    detail: config.modo === "servidor"
      ? "Este computador deixará de ser o caixa principal. Os dados continuam guardados nele, mas os aparelhos só voltam a funcionar quando outro caixa principal for configurado."
      : "Você poderá escolher outro caixa principal ou transformar este computador no caixa principal.",
  });
  if (escolha !== 1) return;
  if (servidor) {
    await servidor.parar().catch(() => {});
    servidor = null;
  }
  salvarConfig({});
  janela.loadFile(path.join(__dirname, "inicio", "index.html"));
}

ipcMain.handle("inicio:procurar", () => procurarServidores());
ipcMain.handle("inicio:reconectar", () => abrirTerminal());
ipcMain.handle("inicio:escolher", async (_e, escolha) => {
  if (escolha.modo === "terminal") {
    const estado = await servidorResponde(escolha.servidor);
    if (!estado) throw new Error("Não foi possível conectar a esse endereço. Confira se o caixa principal está ligado e na mesma rede.");
    salvarConfig({ modo: "terminal", servidor: escolha.servidor, nome: estado.restaurante?.nome });
  } else {
    salvarConfig({ modo: "servidor" });
  }
  await iniciar();
});

async function autoteste() {
  try {
    await new Promise((r) => setTimeout(r, 2500));
    const base = config.modo === "servidor" ? `http://127.0.0.1:${porta}` : config.servidor;
    const estado = await (await fetch(`${base}/api/estado`)).json();
    const encontrados = config.modo === "terminal" ? await procurarServidores() : undefined;
    const imagem = await janela.webContents.capturePage();
    const arquivo = path.join(app.getPath("temp"), `operatto-autoteste-${config.modo}.png`);
    fs.writeFileSync(arquivo, imagem.toPNG());
    console.log(`AUTOTESTE ${JSON.stringify({ modo: config.modo, porta, url: janela.webContents.getURL(), estado, produtos: servidor?.banco.um("select count(*) as n from produtos").n, encontrados, captura: arquivo })}`);
  } catch (erro) {
    console.log(`AUTOTESTE ${JSON.stringify({ falha: erro.message })}`);
  }
  saindo = true;
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!janela) return;
    if (janela.isMinimized()) janela.restore();
    janela.focus();
  });
  app.whenReady().then(iniciar);
  app.on("before-quit", () => { saindo = true; });
  app.on("window-all-closed", async () => {
    await servidor?.parar().catch(() => {});
    app.quit();
  });
}

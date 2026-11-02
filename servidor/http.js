// Servidor HTTP mínimo: rotas da API, arquivos da interface e eventos em tempo real (SSE).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

const TIPOS = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json", ".mp3": "audio/mpeg",
};

function criarServidor({ pastaWeb, autenticar }) {
  const rotas = [];
  const ouvintes = new Set(); // conexões de eventos em tempo real

  function rota(metodo, padrao, opcoes, manipulador) {
    if (typeof opcoes === "function") [manipulador, opcoes] = [opcoes, {}];
    const nomes = [];
    const regex = new RegExp(`^${padrao.replace(/:(\w+)/g, (_, nome) => { nomes.push(nome); return "([^/]+)"; })}$`);
    rotas.push({ metodo, regex, nomes, opcoes, manipulador });
  }

  // Envia um aviso para todos os aparelhos conectados (ex.: novo item para a cozinha).
  function avisar(tipo, dados = {}) {
    const texto = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const ouvinte of ouvintes) ouvinte.res.write(texto);
  }

  function lerCorpo(req) {
    return new Promise((resolve, reject) => {
      let tamanho = 0;
      const partes = [];
      req.on("data", (parte) => {
        tamanho += parte.length;
        if (tamanho > 2 * 1024 * 1024) {
          reject(new ErroHttp(413, "Requisição grande demais."));
          req.destroy();
        } else partes.push(parte);
      });
      req.on("end", () => {
        if (!partes.length) return resolve({});
        try {
          resolve(JSON.parse(Buffer.concat(partes).toString("utf8")));
        } catch {
          reject(new ErroHttp(400, "Dados inválidos."));
        }
      });
      req.on("error", reject);
    });
  }

  function responder(res, status, corpo) {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify(corpo));
  }

  function arquivoEstatico(req, res, caminho) {
    const relativo = caminho === "/" ? "index.html" : decodeURIComponent(caminho).replace(/^\/+/, "");
    const arquivo = path.join(pastaWeb, relativo);
    if (!arquivo.startsWith(pastaWeb) || !fs.existsSync(arquivo) || fs.statSync(arquivo).isDirectory()) {
      // Qualquer endereço desconhecido abre a interface (ela decide a tela).
      const indice = path.join(pastaWeb, "index.html");
      res.writeHead(200, { "Content-Type": TIPOS[".html"], "Cache-Control": "no-store" });
      return fs.createReadStream(indice).pipe(res);
    }
    const tipo = TIPOS[path.extname(arquivo)] || "application/octet-stream";
    const cache = /\/vendor\//.test(arquivo.replace(/\\/g, "/")) ? "public, max-age=604800" : "no-store";
    res.writeHead(200, { "Content-Type": tipo, "Cache-Control": cache, "X-Content-Type-Options": "nosniff" });
    fs.createReadStream(arquivo).pipe(res);
  }

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://operatto");
    res.setHeader("X-Frame-Options", "DENY");
    if (!url.pathname.startsWith("/api/")) return arquivoEstatico(req, res, url.pathname);

    // Eventos em tempo real: o aparelho fica conectado e recebe avisos.
    if (url.pathname === "/api/eventos") {
      const sessao = autenticar(url.searchParams.get("token"));
      if (!sessao) return responder(res, 401, { erro: "Sessão expirada. Entre novamente." });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("retry: 3000\n\n");
      const ouvinte = { res, sessao };
      ouvintes.add(ouvinte);
      const pulso = setInterval(() => res.write(": pulso\n\n"), 25000);
      req.on("close", () => {
        clearInterval(pulso);
        ouvintes.delete(ouvinte);
      });
      return;
    }

    const encontrada = rotas.find((r) => r.metodo === req.method && r.regex.test(url.pathname));
    if (!encontrada) return responder(res, 404, { erro: "Recurso não encontrado." });
    try {
      const valores = encontrada.regex.exec(url.pathname).slice(1);
      const params = Object.fromEntries(encontrada.nomes.map((nome, i) => [nome, decodeURIComponent(valores[i])]));
      let sessao = null;
      if (!encontrada.opcoes.publica) {
        const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
        sessao = autenticar(token);
        if (!sessao) throw new ErroHttp(401, "Sessão expirada. Entre novamente.");
        const papeis = encontrada.opcoes.papeis;
        if (papeis && !papeis.includes(sessao.usuario.papel)) throw new ErroHttp(403, "Seu perfil não tem acesso a esta função.");
      }
      const corpo = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await lerCorpo(req) : {};
      const resultado = await encontrada.manipulador({ params, query: url.searchParams, corpo, sessao, req });
      responder(res, 200, resultado ?? { ok: true });
    } catch (erro) {
      const status = erro.status || 500;
      if (status === 500) console.error(erro);
      responder(res, status, { erro: status === 500 ? "Erro interno no servidor. Tente novamente." : erro.message });
    }
  });

  return { servidor, rota, avisar, conectados: () => [...ouvintes].map((o) => ({ usuario: o.sessao.usuario.nome, papel: o.sessao.usuario.papel, dispositivo: o.sessao.dispositivo })) };
}

module.exports = { criarServidor, ErroHttp };

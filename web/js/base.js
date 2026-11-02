"use strict";

// Base da interface: comunicação com o servidor, eventos em tempo real, formatação e componentes.
const OP = window.OP = { telas: {}, estado: { usuario: null, sistema: null, restaurante: null } };

(() => {
  const TOKEN = "operatto:token";
  const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
  const $$ = (seletor, raiz = document) => [...raiz.querySelectorAll(seletor)];
  const esc = (texto) => String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- Dinheiro (centavos ↔ texto) ----------
  const formatador = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const dinheiro = (centavos) => formatador.format((Number(centavos) || 0) / 100);
  function lerDinheiro(texto) {
    const limpo = String(texto ?? "").trim().replace(/[R$\s]/g, "");
    if (!limpo) return null;
    const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
    const valor = Number(normal);
    return Number.isFinite(valor) && valor >= 0 ? Math.round(valor * 100) : null;
  }
  const paraCampo = (centavos) => ((Number(centavos) || 0) / 100).toFixed(2).replace(".", ",");

  // ---------- Datas ----------
  const hora = (ts) => new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dataHora = (ts) => new Date(ts).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  function minutosDesde(ts) {
    return Math.max(0, Math.floor((Date.now() - ts) / 60000));
  }
  function tempoDesde(ts) {
    const min = minutosDesde(ts);
    if (min < 1) return "agora";
    if (min < 60) return `${min} min`;
    return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  }

  // ---------- API ----------
  const token = () => localStorage.getItem(TOKEN);
  function guardarToken(valor) {
    if (valor) localStorage.setItem(TOKEN, valor);
    else localStorage.removeItem(TOKEN);
  }

  async function api(metodo, caminho, corpo) {
    let resposta;
    try {
      resposta = await fetch(caminho, {
        method: metodo,
        headers: { "Content-Type": "application/json", ...(token() ? { Authorization: `Bearer ${token()}` } : {}) },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new Error("Sem conexão com o computador do caixa. Confira o Wi-Fi.");
    }
    const dados = await resposta.json().catch(() => ({}));
    if (resposta.status === 401 && token()) {
      guardarToken(null);
      OP.app?.sair(dados.erro);
    }
    if (!resposta.ok) throw new Error(dados.erro || "Não foi possível concluir.");
    return dados;
  }

  // ---------- Eventos em tempo real ----------
  let fonte = null;
  const ouvintes = new Map();
  function conectarEventos() {
    fonte?.close();
    if (!token()) return;
    fonte = new EventSource(`/api/eventos?token=${encodeURIComponent(token())}`);
    ["pedido", "mesas", "cozinha", "caixa", "cardapio", "pronto", "conta"].forEach((tipo) => {
      fonte.addEventListener(tipo, (evento) => {
        const dados = JSON.parse(evento.data || "{}");
        (ouvintes.get(tipo) || []).forEach((fn) => fn(dados));
        (ouvintes.get("*") || []).forEach((fn) => fn(tipo, dados));
      });
    });
    fonte.onopen = () => document.body.classList.remove("offline");
    fonte.onerror = () => document.body.classList.add("offline");
  }
  function ouvir(tipo, fn) {
    if (!ouvintes.has(tipo)) ouvintes.set(tipo, []);
    ouvintes.get(tipo).push(fn);
  }
  function desconectarEventos() {
    fonte?.close();
    fonte = null;
  }

  // ---------- Avisos, janelas e sons ----------
  let toastTimer = null;
  function aviso(mensagem, tipo = "ok") {
    const el = $("#toast");
    el.textContent = mensagem;
    el.dataset.tipo = tipo;
    el.classList.add("mostrar");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("mostrar"), tipo === "erro" ? 5000 : 3000);
  }

  function janela(html, { classe = "", aoFechar } = {}) {
    const dialogo = document.createElement("dialog");
    dialogo.className = `janela ${classe}`;
    dialogo.innerHTML = html;
    document.body.appendChild(dialogo);
    dialogo.addEventListener("close", () => {
      aoFechar?.();
      dialogo.remove();
    });
    dialogo.addEventListener("click", (evento) => {
      if (evento.target.closest("[data-fechar]")) dialogo.close();
    });
    dialogo.showModal();
    return dialogo;
  }

  // Formulário em janela: campos simples, valida e chama salvar(dados).
  function formulario({ titulo, campos, valores = {}, botao = "Salvar", salvar, intro = "" }) {
    const html = `
      <form class="form-janela" novalidate>
        <header class="janela-topo"><h2>${esc(titulo)}</h2><button type="button" class="btn-icone" data-fechar aria-label="Fechar">✕</button></header>
        ${intro ? `<p class="intro">${intro}</p>` : ""}
        <div class="campos">${campos.map((c) => campoHtml(c, valores[c.nome])).join("")}</div>
        <p class="erro" role="alert"></p>
        <footer><button type="button" class="btn" data-fechar>Cancelar</button><button type="submit" class="btn primario">${esc(botao)}</button></footer>
      </form>`;
    const dialogo = janela(html);
    const form = $("form", dialogo);
    $("input, select, textarea", form)?.focus();
    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const erro = $(".erro", form);
      erro.textContent = "";
      const dados = {};
      for (const c of campos) {
        const el = form.elements[c.nome];
        if (!el) continue;
        let valor = c.tipo === "checkbox" ? el.checked : el.value.trim();
        if (c.tipo === "dinheiro") {
          valor = lerDinheiro(valor);
          if (valor === null && c.obrigatorio) return (erro.textContent = `Informe ${c.rotulo.toLowerCase()}.`);
        } else if (c.obrigatorio && !valor) return (erro.textContent = `Preencha: ${c.rotulo}.`);
        if (c.tipo === "numero") valor = valor === "" ? null : Number(valor);
        dados[c.nome] = valor;
      }
      const botaoEnviar = $("[type=submit]", form);
      botaoEnviar.disabled = true;
      try {
        await salvar(dados);
        dialogo.close();
      } catch (problema) {
        erro.textContent = problema.message;
      } finally {
        botaoEnviar.disabled = false;
      }
    });
    return dialogo;
  }

  function campoHtml(c, valor) {
    const id = `campo-${c.nome}`;
    const largo = c.largo ? " largo" : "";
    const ajuda = c.ajuda ? `<small>${esc(c.ajuda)}</small>` : "";
    if (c.tipo === "checkbox") return `<label class="check${largo}"><input type="checkbox" name="${c.nome}" ${valor ? "checked" : ""}/> ${esc(c.rotulo)}${ajuda}</label>`;
    if (c.tipo === "select") {
      const opcoes = c.opcoes.map((o) => `<option value="${esc(o.valor)}" ${String(o.valor) === String(valor ?? "") ? "selected" : ""}>${esc(o.rotulo)}</option>`).join("");
      return `<label class="${largo}" for="${id}">${esc(c.rotulo)}<select id="${id}" name="${c.nome}">${c.vazio !== false ? `<option value="">${esc(c.vazio || "Selecione")}</option>` : ""}${opcoes}</select>${ajuda}</label>`;
    }
    if (c.tipo === "textarea") return `<label class="${largo}" for="${id}">${esc(c.rotulo)}<textarea id="${id}" name="${c.nome}" rows="2" placeholder="${esc(c.placeholder || "")}">${esc(valor ?? "")}</textarea>${ajuda}</label>`;
    const tipo = c.tipo === "dinheiro" ? "text" : c.tipo === "numero" ? "number" : c.tipo || "text";
    const modo = c.tipo === "dinheiro" ? ' inputmode="decimal"' : c.tipo === "pin" ? ' inputmode="numeric" maxlength="6"' : "";
    const texto = c.tipo === "dinheiro" && valor !== undefined && valor !== null ? paraCampo(valor) : valor ?? "";
    return `<label class="${largo}" for="${id}">${esc(c.rotulo)}<input id="${id}" name="${c.nome}" type="${c.tipo === "pin" ? "password" : tipo}"${modo} value="${esc(texto)}" placeholder="${esc(c.placeholder || "")}" ${c.min !== undefined ? `min="${c.min}"` : ""} autocomplete="off"/>${ajuda}</label>`;
  }

  function confirmar(mensagem, { titulo = "Confirmar", botao = "Confirmar", perigo = false } = {}) {
    return new Promise((resolve) => {
      let resposta = false;
      const dialogo = janela(`
        <div class="form-janela pequena">
          <header class="janela-topo"><h2>${esc(titulo)}</h2></header>
          <p>${esc(mensagem)}</p>
          <footer><button class="btn" data-fechar>Voltar</button><button class="btn ${perigo ? "perigo" : "primario"}" data-sim>${esc(botao)}</button></footer>
        </div>`, { aoFechar: () => resolve(resposta) });
      $("[data-sim]", dialogo).addEventListener("click", () => { resposta = true; dialogo.close(); });
    });
  }

  // Bipe gerado na hora (sem arquivo de áudio): novo pedido na cozinha, item pronto para o garçom.
  let audio = null;
  function bipe(tipo = "novo") {
    try {
      audio = audio || new AudioContext();
      const notas = tipo === "pronto" ? [880, 1175] : [660, 880, 990];
      notas.forEach((freq, i) => {
        const osc = audio.createOscillator();
        const ganho = audio.createGain();
        osc.frequency.value = freq;
        osc.type = "sine";
        ganho.gain.setValueAtTime(0.0001, audio.currentTime + i * 0.16);
        ganho.gain.exponentialRampToValueAtTime(0.35, audio.currentTime + i * 0.16 + 0.02);
        ganho.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + i * 0.16 + 0.15);
        osc.connect(ganho).connect(audio.destination);
        osc.start(audio.currentTime + i * 0.16);
        osc.stop(audio.currentTime + i * 0.16 + 0.16);
      });
      navigator.vibrate?.(tipo === "pronto" ? [120, 80, 120] : 200);
    } catch { /* aparelho sem som */ }
  }

  const normalizar = (texto) => String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

  const PAPEL = { gerente: "Gerente", caixa: "Caixa", garcom: "Garçom", cozinha: "Cozinha", entregador: "Entregador" };
  const FORMA = { dinheiro: "Dinheiro", pix: "Pix", debito: "Débito", credito: "Crédito", vale: "Vale-refeição" };
  const ENTREGA = { recebido: "Recebido", preparo: "Em preparo", saiu: "Saiu para entrega", entregue: "Entregue" };

  Object.assign(OP, {
    $, $$, esc, dinheiro, lerDinheiro, paraCampo, hora, dataHora, minutosDesde, tempoDesde,
    api, guardarToken, token, conectarEventos, desconectarEventos, ouvir,
    aviso, janela, formulario, confirmar, bipe, normalizar, PAPEL, FORMA, ENTREGA,
    pode: (...papeis) => papeis.includes(OP.estado.usuario?.papel),
  });
})();

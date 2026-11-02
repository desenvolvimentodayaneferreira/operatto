"use strict";

// Inicialização, menu por perfil e navegação entre telas (#/endereço).
(() => {
  const { $, esc, api, guardarToken, conectarEventos, desconectarEventos, ouvir, aviso, bipe, PAPEL } = OP;

  // Telas de cada perfil (a primeira é a inicial).
  const MENU = {
    gerente: [["painel", "Painel", "◴"], ["salao", "Salão", "▦"], ["balcao", "Balcão", "▣"], ["delivery", "Delivery", "➤"], ["cozinha", "Cozinha", "♨"], ["caixa", "Caixa", "▤"], ["cardapio", "Cardápio", "☰"], ["equipe", "Equipe", "◎"], ["config", "Configurações", "⚙"]],
    caixa: [["salao", "Salão", "▦"], ["balcao", "Balcão", "▣"], ["delivery", "Delivery", "➤"], ["caixa", "Caixa", "▤"], ["cozinha", "Cozinha", "♨"]],
    garcom: [["salao", "Mesas", "▦"]],
    cozinha: [["cozinha", "Cozinha", "♨"]],
    entregador: [["delivery", "Entregas", "➤"]],
  };

  let telaAtual = null;

  function rota() {
    const [nome, ...resto] = location.hash.replace(/^#\/?/, "").split("/");
    return { nome, params: resto };
  }

  function ir(caminho) {
    if (location.hash === `#/${caminho}`) mostrar();
    else location.hash = `#/${caminho}`;
  }

  function layout() {
    const usuario = OP.estado.usuario;
    const itens = MENU[usuario.papel];
    const restaurante = OP.estado.restaurante?.nome || "Restaurante";
    $("#raiz").innerHTML = `
      <div class="app papel-${usuario.papel}">
        <aside class="lateral">
          <div class="marca"><img src="assets/logo.svg" alt="Operatto"/><div><b>OPERATTO</b><small>by KAI</small></div></div>
          <div class="cliente"><span>${esc(restaurante.split(/\s+/).slice(0, 2).map((p) => p[0]).join(""))}</span><b>${esc(restaurante)}</b></div>
          <nav>${itens.map(([id, rotulo, icone]) => `<a href="#/${id}" data-menu="${id}"><i>${icone}</i>${rotulo}<em class="contador" data-contador="${id}"></em></a>`).join("")}</nav>
          <div class="usuario"><span>${esc(usuario.nome[0])}</span><div><b>${esc(usuario.nome)}</b><small>${PAPEL[usuario.papel]}</small></div><button class="btn-icone" data-sair title="Sair" aria-label="Sair"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9"/></svg></button></div>
        </aside>
        <header class="topo-movel">
          <b>${esc(restaurante)}</b>
          <span>${esc(usuario.nome)} · ${PAPEL[usuario.papel]}</span>
          <button class="btn-icone" data-sair title="Sair" aria-label="Sair"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M15 16l4-4-4-4M19 12H9"/></svg></button>
        </header>
        <main id="conteudo"></main>
        ${itens.length > 1 ? `<nav class="abas-movel">${itens.slice(0, 5).map(([id, rotulo, icone]) => `<a href="#/${id}" data-menu="${id}"><i>${icone}</i><span>${rotulo}</span></a>`).join("")}</nav>` : ""}
      </div>`;
    document.querySelectorAll("[data-sair]").forEach((botao) => botao.addEventListener("click", () => sair()));
  }

  async function mostrar() {
    if (!OP.estado.usuario) return;
    const permitidas = MENU[OP.estado.usuario.papel].map(([id]) => id);
    let { nome, params } = rota();
    const extras = { pedido: ["salao", "balcao", "delivery", "caixa"] }; // telas abertas a partir de outras
    if (!permitidas.includes(nome) && !(extras[nome] && extras[nome].some((t) => permitidas.includes(t)))) {
      return ir(permitidas[0]);
    }
    telaAtual?.sair?.();
    document.querySelectorAll("[data-menu]").forEach((link) => link.classList.toggle("ativo", link.dataset.menu === (nome === "pedido" ? params[1] || "salao" : nome)));
    // Cada tela desenha numa área nova: respostas atrasadas de uma tela antiga caem numa área já descartada.
    const area = document.createElement("div");
    area.className = "tela";
    area.innerHTML = '<div class="carregando">Carregando…</div>';
    $("#conteudo").replaceChildren(area);
    telaAtual = OP.telas[nome];
    try {
      await telaAtual.abrir(area, params);
    } catch (erro) {
      if (area.isConnected) area.innerHTML = `<div class="vazio"><b>Não foi possível abrir</b><p>${esc(erro.message)}</p></div>`;
    }
    window.scrollTo(0, 0);
  }

  async function entrar(dados) {
    guardarToken(dados.token);
    OP.estado.usuario = dados.usuario;
    await iniciarSessao();
  }

  async function iniciarSessao() {
    OP.estado.sistema = await api("GET", "/api/sistema");
    layout();
    conectarEventos();
    if (!location.hash || location.hash === "#/") ir(MENU[OP.estado.usuario.papel][0][0]);
    else mostrar();
  }

  function sair(motivo) {
    if (OP.estado.usuario) api("POST", "/api/sair").catch(() => {});
    guardarToken(null);
    desconectarEventos();
    telaAtual?.sair?.();
    telaAtual = null;
    OP.estado.usuario = null;
    history.replaceState(null, "", "/");
    OP.telas.login.abrir($("#raiz"));
    if (motivo) aviso(motivo, "erro");
  }

  // Eventos em tempo real vão para a tela aberta; avisos sonoros por perfil.
  ouvir("*", (tipo, dados) => telaAtual?.aoEvento?.(tipo, dados));
  ouvir("pronto", (dados) => {
    const usuario = OP.estado.usuario;
    if (usuario?.papel === "garcom" && (!dados.garcom_id || dados.garcom_id === usuario.id)) {
      bipe("pronto");
      aviso(`Pronto: ${dados.item}`);
    }
  });
  ouvir("conta", () => {
    if (OP.pode("caixa", "gerente")) {
      bipe("pronto");
      aviso("Uma mesa pediu a conta.");
    }
  });

  window.addEventListener("hashchange", mostrar);

  async function iniciar() {
    try {
      const estado = await api("GET", "/api/estado");
      OP.estado.restaurante = estado.restaurante;
      if (!estado.configurado) return OP.telas.login.configurar($("#raiz"));
      if (OP.token()) {
        try {
          OP.estado.usuario = await api("GET", "/api/eu");
          return await iniciarSessao();
        } catch { /* sessão expirada: pede o PIN */ }
      }
      OP.telas.login.abrir($("#raiz"));
    } catch (erro) {
      $("#raiz").innerHTML = `<div class="vazio tela-cheia"><b>Sem conexão com o Operatto</b><p>${esc(erro.message)}</p><button class="btn primario" data-recarregar>Tentar de novo</button></div>`;
      $("[data-recarregar]").addEventListener("click", () => location.reload());
    }
  }

  OP.app = { ir, entrar, sair, mostrar, recarregar: () => mostrar() };
  iniciar();
})();

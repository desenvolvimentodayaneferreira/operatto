"use strict";

// Tela da cozinha (KDS): pedidos chegam em tempo real, com tempo de espera e bipe de aviso.
(() => {
  const { $, $$, esc, api, hora, minutosDesde, tempoDesde, aviso, bipe } = OP;
  const CHAVE_SETOR = "operatto:setor-cozinha";

  let raiz = null;
  let setores = [];
  let setor = "";
  let conhecidos = null;
  let relogio = null;

  const destino = (i) => (i.tipo === "mesa" ? `Mesa ${i.mesa_numero}` : i.tipo === "balcao" ? `Balcão${i.cliente_nome ? ` · ${i.cliente_nome}` : ""}` : `Delivery${i.cliente_nome ? ` · ${i.cliente_nome}` : ""}`);

  function agrupar(itens, status) {
    const grupos = new Map();
    itens.filter((i) => i.status === status).forEach((i) => {
      const chave = `${i.pedido_id}`;
      if (!grupos.has(chave)) grupos.set(chave, { pedido_id: i.pedido_id, numero: i.numero, destino: destino(i), tipo: i.tipo, obs: i.pedido_obs, itens: [] });
      grupos.get(chave).itens.push(i);
    });
    return [...grupos.values()].sort((a, b) => Math.min(...a.itens.map((i) => i.lancado_em)) - Math.min(...b.itens.map((i) => i.lancado_em)));
  }

  function cartao(grupo, status) {
    const inicio = Math.min(...grupo.itens.map((i) => i.lancado_em));
    const espera = minutosDesde(inicio);
    const nivel = status === "pronto" ? "ok" : espera >= 25 ? "atrasado" : espera >= 15 ? "atencao" : "ok";
    const acao = { novo: ["Começar tudo", "preparo"], preparo: ["Tudo pronto", "pronto"], pronto: ["Retirado", "entregue"] }[status];
    return `
      <article class="ticket ${nivel} tipo-${grupo.tipo}">
        <header><b>${esc(grupo.destino)}</b><span>#${grupo.numero}</span><em>${status === "pronto" ? "pronto" : tempoDesde(inicio)}</em></header>
        ${grupo.obs ? `<p class="ticket-obs">${esc(grupo.obs)}</p>` : ""}
        <ul>${grupo.itens.map((i) => `
          <li data-item="${i.id}" data-status="${i.status}">
            <span class="qtd">${i.quantidade}×</span>
            <div><b>${esc(i.nome)}</b>${i.observacao ? `<small>⚠ ${esc(i.observacao)}</small>` : ""}${setor ? "" : `<small class="setor">${esc(i.setor_nome || "")}</small>`}</div>
            <span class="hora">${hora(i.lancado_em)}</span>
          </li>`).join("")}</ul>
        <button class="btn ${status === "pronto" ? "" : "primario"} largo" data-grupo="${grupo.pedido_id}" data-de="${status}" data-para="${acao[1]}">${acao[0]}</button>
      </article>`;
  }

  async function carregar() {
    const itens = await api("GET", `/api/cozinha${setor ? `?setor=${setor}` : ""}`);
    const ids = new Set(itens.filter((i) => i.status === "novo").map((i) => i.id));
    if (conhecidos && [...ids].some((id) => !conhecidos.has(id))) {
      bipe("novo");
      document.body.classList.add("piscar");
      setTimeout(() => document.body.classList.remove("piscar"), 1200);
    }
    conhecidos = ids;
    const colunas = [["novo", "Na fila"], ["preparo", "Em preparo"], ["pronto", "Prontos"]];
    const fixo = OP.pode("cozinha") && OP.estado.usuario.setor;
    raiz.innerHTML = `
      <div class="cozinha">
        <div class="titulo-tela">
          <div><h1>${esc(setores.find((s) => String(s.id) === String(setor))?.nome || "Cozinha")}</h1><p>Toque num item para avançar · ${itens.filter((i) => i.status !== "pronto").length} item(ns) em aberto</p></div>
          <div class="acoes-linha">
            ${fixo ? "" : `<div class="filtros">${[["", "Todos"], ...setores.map((s) => [String(s.id), s.nome])].map(([id, nome]) => `<button class="chip ${String(setor) === id ? "ativo" : ""}" data-setor="${id}">${esc(nome)}</button>`).join("")}</div>`}
            <button class="btn" data-tela-cheia>⛶ Tela cheia</button>
          </div>
        </div>
        <div class="kds">
          ${colunas.map(([status, rotulo]) => {
            const grupos = agrupar(itens, status);
            return `<section class="coluna coluna-${status}"><h2>${rotulo} <b>${grupos.reduce((s, g) => s + g.itens.length, 0)}</b></h2>${grupos.map((g) => cartao(g, status)).join("") || '<p class="sutil">Nada aqui.</p>'}</section>`;
          }).join("")}
        </div>
      </div>`;
    ligar(itens);
  }

  function ligar(itens) {
    $$("[data-setor]", raiz).forEach((b) => b.addEventListener("click", () => {
      setor = b.dataset.setor;
      localStorage.setItem(CHAVE_SETOR, setor);
      conhecidos = null;
      carregar();
    }));
    $("[data-tela-cheia]", raiz).addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {}));
    const proximo = { novo: "preparo", preparo: "pronto", pronto: "entregue" };
    $$("[data-item]", raiz).forEach((li) => li.addEventListener("click", () => mudar([Number(li.dataset.item)], proximo[li.dataset.status])));
    $$("[data-grupo]", raiz).forEach((b) => b.addEventListener("click", () => {
      const alvo = itens.filter((i) => i.pedido_id === Number(b.dataset.grupo) && i.status === b.dataset.de).map((i) => i.id);
      mudar(alvo, b.dataset.para);
    }));
  }

  async function mudar(ids, status) {
    try {
      for (const id of ids) await api("POST", `/api/itens/${id}/status`, { status });
      await carregar();
    } catch (erro) {
      aviso(erro.message, "erro");
    }
  }

  OP.telas.cozinha = {
    async abrir(conteudo) {
      raiz = conteudo;
      conhecidos = null;
      setores = (await api("GET", "/api/cardapio")).setores;
      setor = OP.pode("cozinha") && OP.estado.usuario.setor ? String(OP.estado.usuario.setor) : localStorage.getItem(CHAVE_SETOR) || "";
      await carregar();
      relogio = setInterval(() => carregar().catch(() => {}), 30000); // atualiza o tempo de espera
    },
    sair() {
      clearInterval(relogio);
    },
    aoEvento(tipo) {
      if (tipo === "cozinha") carregar().catch(() => {});
    },
  };
})();

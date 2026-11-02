"use strict";

// Salão (mapa de mesas) e Balcão (vendas rápidas no caixa).
(() => {
  const { $, $$, esc, api, dinheiro, tempoDesde, aviso } = OP;
  let filtro = "todas";
  let raiz = null;

  async function carregarMesas() {
    const mesas = await api("GET", "/api/mesas");
    const contagem = { livre: 0, ocupada: 0, conta: 0 };
    mesas.forEach((m) => { contagem[m.situacao] += 1; });
    const visiveis = mesas.filter((m) => filtro === "todas" || m.situacao === filtro);
    raiz.innerHTML = `
      <div class="titulo-tela">
        <div><h1>${OP.pode("garcom") ? "Mesas" : "Salão"}</h1><p>${contagem.ocupada + contagem.conta} de ${mesas.length} mesas ocupadas</p></div>
      </div>
      <div class="filtros">
        ${[["todas", "Todas", mesas.length], ["livre", "Livres", contagem.livre], ["ocupada", "Ocupadas", contagem.ocupada], ["conta", "Pediram a conta", contagem.conta]]
          .map(([id, rotulo, n]) => `<button class="chip ${filtro === id ? "ativo" : ""} chip-${id}" data-filtro="${id}">${rotulo} <b>${n}</b></button>`).join("")}
      </div>
      <div class="mesas">
        ${visiveis.map((m) => `
          <button class="mesa ${m.situacao}" data-mesa="${m.id}">
            <span class="mesa-numero">${m.numero}</span>
            ${m.pedido ? `
              <span class="mesa-total">${dinheiro(m.pedido.total)}</span>
              <span class="mesa-info">${tempoDesde(m.pedido.aberto_em)}${m.pedido.garcom_nome ? ` · ${esc(m.pedido.garcom_nome.split(" ")[0])}` : ""}</span>
              ${m.pedido.prontos ? `<span class="mesa-pronto">${m.pedido.prontos} pronto${m.pedido.prontos > 1 ? "s" : ""}</span>` : ""}
              ${m.situacao === "conta" ? '<span class="mesa-conta">CONTA</span>' : ""}`
              : `<span class="mesa-info">${m.lugares} lugares</span>`}
          </button>`).join("") || '<div class="vazio">Nenhuma mesa nesta situação.</div>'}
      </div>`;
    $$("[data-filtro]", raiz).forEach((b) => b.addEventListener("click", () => { filtro = b.dataset.filtro; carregarMesas(); }));
    $$("[data-mesa]", raiz).forEach((b) => b.addEventListener("click", () => abrirMesa(mesas.find((m) => m.id === Number(b.dataset.mesa)))));
  }

  async function abrirMesa(mesa) {
    try {
      const pedido = mesa.pedido ? mesa.pedido : await api("POST", "/api/pedidos", { tipo: "mesa", mesa_id: mesa.id });
      OP.app.ir(`pedido/${pedido.id}/salao`);
    } catch (erro) {
      aviso(erro.message, "erro");
    }
  }

  OP.telas.salao = {
    async abrir(conteudo) {
      raiz = conteudo;
      await carregarMesas();
    },
    aoEvento(tipo) {
      if (["mesas", "pedido"].includes(tipo)) carregarMesas().catch(() => {});
    },
  };

  // ---------- Balcão ----------
  let raizBalcao = null;
  async function carregarBalcao() {
    const pedidos = await api("GET", "/api/pedidos?status=abertos&tipo=balcao");
    raizBalcao.innerHTML = `
      <div class="titulo-tela">
        <div><h1>Balcão</h1><p>Vendas para viagem ou consumo no balcão</p></div>
        <button class="btn primario grande" data-nova>+ Nova venda</button>
      </div>
      <div class="lista-cartoes">
        ${pedidos.map((p) => `
          <button class="cartao-pedido" data-pedido="${p.id}">
            <b>#${p.numero}${p.cliente_nome ? ` · ${esc(p.cliente_nome)}` : ""}</b>
            <span>${dinheiro(p.totais.total)}</span>
            <small>${tempoDesde(p.aberto_em)}${p.totais.pago ? ` · pago ${dinheiro(p.totais.pago)}` : ""}</small>
          </button>`).join("") || '<div class="vazio">Nenhuma venda de balcão em aberto.</div>'}
      </div>`;
    $("[data-nova]", raizBalcao).addEventListener("click", () => OP.formulario({
      titulo: "Nova venda no balcão",
      campos: [{ nome: "cliente_nome", rotulo: "Nome do cliente (opcional)", placeholder: "Para chamar quando ficar pronto", largo: true }],
      botao: "Abrir venda",
      async salvar(dados) {
        const pedido = await api("POST", "/api/pedidos", { tipo: "balcao", cliente_nome: dados.cliente_nome });
        OP.app.ir(`pedido/${pedido.id}/balcao`);
      },
    }));
    $$("[data-pedido]", raizBalcao).forEach((b) => b.addEventListener("click", () => OP.app.ir(`pedido/${b.dataset.pedido}/balcao`)));
  }

  OP.telas.balcao = {
    async abrir(conteudo) {
      raizBalcao = conteudo;
      await carregarBalcao();
    },
    aoEvento(tipo) {
      if (tipo === "pedido") carregarBalcao().catch(() => {});
    },
  };
})();

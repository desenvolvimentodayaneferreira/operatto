"use strict";

// Delivery: quadro de entregas do dia, novo pedido com busca do cliente pelo telefone e taxa do bairro.
(() => {
  const { $, $$, esc, api, dinheiro, hora, tempoDesde, aviso, ENTREGA } = OP;
  let raiz = null;

  async function carregar() {
    const souEntregador = OP.pode("entregador");
    const [pedidos, entregadores] = await Promise.all([api("GET", "/api/pedidos?tipo=delivery&hoje=1"), souEntregador ? Promise.resolve([]) : api("GET", "/api/entregadores")]);
    const ativos = pedidos.filter((p) => p.status !== "cancelado");
    const meus = souEntregador ? ativos.filter((p) => ["preparo", "recebido"].includes(p.entrega_status) || p.entregador_id === OP.estado.usuario.id) : ativos;
    OP.estado.entregadores = entregadores;
    const colunas = ["recebido", "preparo", "saiu", "entregue"];
    raiz.innerHTML = `
      <div class="titulo-tela">
        <div><h1>${souEntregador ? "Entregas" : "Delivery"}</h1><p>${ativos.length} pedido(s) hoje · ${dinheiro(ativos.reduce((s, p) => s + p.totais.total, 0))}</p></div>
        ${souEntregador ? "" : '<button class="btn primario grande" data-novo>+ Novo delivery</button>'}
      </div>
      <div class="quadro">
        ${colunas.map((status) => {
          const lista = meus.filter((p) => p.entrega_status === status);
          return `<section class="coluna"><h2>${ENTREGA[status]} <b>${lista.length}</b></h2>${lista.map((p) => cartao(p, souEntregador)).join("") || '<p class="sutil">—</p>'}</section>`;
        }).join("")}
      </div>`;
    ligar(meus);
  }

  function cartao(p, souEntregador) {
    const pago = p.totais.restante === 0;
    return `
      <article class="ticket entrega">
        <header><b>#${p.numero} · ${esc(p.cliente_nome || "")}</b><em>${tempoDesde(p.aberto_em)}</em></header>
        <p>${esc(p.entrega_endereco || "")}${p.entrega_bairro ? ` · <b>${esc(p.entrega_bairro)}</b>` : ""}</p>
        <p class="linha"><span>${dinheiro(p.totais.total)} ${pago ? '<em class="pago">pago</em>' : `<em class="a-receber">receber na entrega</em>${p.troco_para ? ` · troco p/ ${dinheiro(p.troco_para)}` : ""}`}</span>${p.entregador_nome ? `<small>🛵 ${esc(p.entregador_nome)}</small>` : ""}</p>
        <div class="acoes-linha">
          ${souEntregador ? "" : `<button class="btn pequeno" data-abrir="${p.id}">Abrir</button>`}
          ${p.entrega_status !== "saiu" && p.entrega_status !== "entregue" ? `<button class="btn pequeno primario" data-saiu="${p.id}">${souEntregador ? "Peguei para entregar" : "Saiu para entrega"}</button>` : ""}
          ${p.entrega_status === "saiu" ? `<button class="btn pequeno sucesso" data-entregue="${p.id}">Entregue</button>` : ""}
        </div>
      </article>`;
  }

  function ligar(pedidos) {
    $("[data-novo]", raiz)?.addEventListener("click", novo);
    $$("[data-abrir]", raiz).forEach((b) => b.addEventListener("click", () => OP.app.ir(`pedido/${b.dataset.abrir}/delivery`)));
    $$("[data-entregue]", raiz).forEach((b) => b.addEventListener("click", () => status(b.dataset.entregue, "entregue")));
    $$("[data-saiu]", raiz).forEach((b) => b.addEventListener("click", () => {
      if (OP.pode("entregador")) return status(b.dataset.saiu, "saiu");
      const entregadores = OP.estado.entregadores || [];
      if (!entregadores.length) return aviso("Cadastre um entregador em Equipe.", "erro");
      OP.formulario({
        titulo: "Saiu para entrega",
        campos: [{ nome: "entregador_id", rotulo: "Entregador", tipo: "select", obrigatorio: true, largo: true, opcoes: entregadores.map((e) => ({ valor: e.id, rotulo: e.nome })) }],
        botao: "Confirmar saída",
        async salvar(dados) { await status(b.dataset.saiu, "saiu", Number(dados.entregador_id)); },
      });
    }));
  }

  async function status(id, novo, entregadorId) {
    try {
      await api("POST", `/api/pedidos/${id}/entrega`, { status: novo, entregador_id: entregadorId });
      await carregar();
    } catch (erro) {
      aviso(erro.message, "erro");
    }
  }

  async function novo() {
    const bairros = await api("GET", "/api/bairros");
    const dialogo = OP.formulario({
      titulo: "Novo pedido de delivery",
      intro: "Digite o telefone: se o cliente já pediu antes, os dados aparecem sozinhos.",
      campos: [
        { nome: "telefone", rotulo: "Telefone / WhatsApp", placeholder: "(81) 9…" },
        { nome: "nome", rotulo: "Nome do cliente", obrigatorio: true },
        { nome: "endereco", rotulo: "Rua / endereço", obrigatorio: true, largo: true },
        { nome: "numero", rotulo: "Número" },
        { nome: "bairro", rotulo: "Bairro", tipo: "select", opcoes: bairros.map((b) => ({ valor: b.nome, rotulo: `${b.nome} · ${dinheiro(b.taxa)}` })), vazio: bairros.length ? "Selecione" : "Cadastre bairros em Configurações" },
        { nome: "complemento", rotulo: "Complemento" },
        { nome: "referencia", rotulo: "Ponto de referência", largo: true },
        { nome: "troco_para", rotulo: "Troco para (R$)", tipo: "dinheiro", ajuda: "Se o cliente vai pagar em dinheiro na entrega" },
        { nome: "observacao", rotulo: "Observação do pedido", tipo: "textarea", largo: true },
      ],
      botao: "Criar e escolher os itens",
      async salvar(dados) {
        const pedido = await api("POST", "/api/pedidos", {
          tipo: "delivery",
          troco_para: dados.troco_para || null,
          observacao: dados.observacao,
          cliente: { telefone: dados.telefone, nome: dados.nome, endereco: dados.endereco, numero: dados.numero, bairro: dados.bairro, complemento: dados.complemento, referencia: dados.referencia },
        });
        OP.app.ir(`pedido/${pedido.id}/delivery`);
      },
    });
    const telefone = dialogo.querySelector("[name=telefone]");
    telefone.addEventListener("change", async () => {
      const digitos = telefone.value.replace(/\D/g, "");
      if (digitos.length < 8) return;
      const [cliente] = await api("GET", `/api/clientes?busca=${digitos}`);
      if (!cliente) return;
      const form = dialogo.querySelector("form");
      ["nome", "endereco", "numero", "bairro", "complemento", "referencia"].forEach((campo) => {
        if (form.elements[campo] && cliente[campo]) form.elements[campo].value = cliente[campo];
      });
      aviso(`Cliente encontrado: ${cliente.nome}`);
    });
  }

  OP.telas.delivery = {
    async abrir(conteudo) {
      raiz = conteudo;
      await carregar();
    },
    aoEvento(tipo, dados) {
      if (tipo === "pedido" && dados.tipo === "delivery" && !document.querySelector("dialog[open]")) carregar().catch(() => {});
    },
  };
})();

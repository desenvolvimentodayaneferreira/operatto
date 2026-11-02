"use strict";

// Tela do pedido (mesa, balcão ou delivery): cardápio, itens a enviar, itens enviados e ações da conta.
(() => {
  const { $, $$, esc, api, dinheiro, hora, tempoDesde, aviso, confirmar, janela } = OP;

  const STATUS = { novo: ["Na fila", "novo"], preparo: ["Em preparo", "preparo"], pronto: ["Pronto", "pronto"], entregue: ["Entregue", "entregue"], cancelado: ["Cancelado", "cancelado"] };
  const OBS_RAPIDAS = ["Sem cebola", "Bem passado", "Ao ponto", "Mal passado", "Sem gelo", "Para viagem", "Pouco sal", "Molho à parte"];

  let raiz = null;
  let pedido = null;
  let cardapio = null;
  let origem = "salao";
  let categoriaAtual = null;
  let busca = "";
  let aba = "cardapio"; // celular: cardapio | conta
  let carrinho = [];

  const chaveCarrinho = () => `operatto:carrinho:${pedido?.id}`;
  const salvarCarrinho = () => sessionStorage.setItem(chaveCarrinho(), JSON.stringify(carrinho));
  const produto = (id) => cardapio.produtos.find((p) => p.id === id);
  const categoria = (id) => cardapio.categorias.find((c) => c.id === id);

  function titulo() {
    if (pedido.tipo === "mesa") return `Mesa ${pedido.mesa_numero}`;
    if (pedido.tipo === "balcao") return `Balcão #${pedido.numero}${pedido.cliente_nome ? ` · ${pedido.cliente_nome}` : ""}`;
    return `Delivery #${pedido.numero} · ${pedido.cliente_nome || ""}`;
  }

  function precoCarrinho(item) {
    const precos = item.sabores ? item.sabores.map((id) => produto(id)?.preco || 0) : [produto(item.produto_id)?.preco || 0];
    return Math.max(...precos) * item.quantidade;
  }
  function nomeCarrinho(item) {
    if (!item.sabores) return produto(item.produto_id)?.nome || "Produto";
    const sabor = (id) => (produto(id)?.nome || "").replace(/\s+(P|M|G|GG)$/i, "").replace(/^Pizza\s+/i, "");
    return `Meio a meio ${produto(item.sabores[0])?.tamanho || ""}: ${sabor(item.sabores[0])} / ${sabor(item.sabores[1])}`;
  }

  // ---------- Desenho ----------

  function desenhar() {
    const encerrado = !["aberto", "conta"].includes(pedido.status);
    const podeReceber = OP.pode("gerente", "caixa");
    const t = pedido.totais;
    const totalCarrinho = carrinho.reduce((soma, item) => soma + precoCarrinho(item), 0);
    raiz.innerHTML = `
      <div class="pedido ${encerrado ? "encerrado" : ""} aba-${aba}">
        <div class="pedido-topo">
          <button class="btn-icone voltar" data-voltar aria-label="Voltar">←</button>
          <div>
            <h1>${esc(titulo())}</h1>
            <p>#${pedido.numero} · aberto às ${hora(pedido.aberto_em)} (${tempoDesde(pedido.aberto_em)})${pedido.garcom_nome ? ` · ${esc(pedido.garcom_nome)}` : ""}${pedido.status === "conta" ? ' · <b class="txt-conta">conta pedida</b>' : ""}${encerrado ? ` · <b>${pedido.status === "fechado" ? "conta fechada" : "cancelado"}</b>` : ""}</p>
          </div>
          <div class="pedido-acoes">
            ${!encerrado && pedido.tipo === "mesa" && pedido.status !== "conta" ? '<button class="btn" data-acao="conta">Pedir conta</button>' : ""}
            ${!encerrado && pedido.tipo === "mesa" ? '<button class="btn" data-acao="transferir">Transferir</button>' : ""}
            ${!encerrado && !pedido.itens.some((i) => i.status !== "cancelado") ? `<button class="btn" data-acao="liberar">${pedido.tipo === "mesa" ? "Liberar mesa" : "Cancelar"}</button>` : ""}
            <button class="btn" data-acao="imprimir">Imprimir conta</button>
            ${podeReceber && !encerrado ? '<button class="btn primario" data-acao="receber">Receber</button>' : ""}
            ${OP.pode("gerente") && !encerrado && pedido.itens.some((i) => i.status !== "cancelado") ? '<button class="btn perigo" data-acao="cancelar">Cancelar pedido</button>' : ""}
          </div>
        </div>

        ${pedido.tipo === "delivery" ? `<div class="faixa-delivery">➤ ${esc(pedido.entrega_endereco || "")}${pedido.entrega_bairro ? ` · ${esc(pedido.entrega_bairro)}` : ""}${pedido.cliente?.telefone ? ` · ${esc(pedido.cliente.telefone)}` : ""}${pedido.troco_para ? ` · troco para ${dinheiro(pedido.troco_para)}` : ""} · <b>${OP.ENTREGA[pedido.entrega_status] || ""}</b></div>` : ""}

        <div class="abas-pedido">
          <button class="${aba === "cardapio" ? "ativo" : ""}" data-aba="cardapio">Cardápio</button>
          <button class="${aba === "conta" ? "ativo" : ""}" data-aba="conta">Conta <b>${dinheiro(t.total)}</b></button>
        </div>

        <div class="pedido-corpo">
          <section class="painel-cardapio">${encerrado ? '<div class="vazio">Pedido encerrado.</div>' : cardapioHtml()}</section>
          <section class="painel-conta">
            ${carrinho.length ? `
              <div class="carrinho">
                <h3>A enviar</h3>
                ${carrinho.map((item, i) => `
                  <div class="linha-item novo-item">
                    <span class="qtd">${item.quantidade}×</span>
                    <div><b>${esc(nomeCarrinho(item))}</b>${item.observacao ? `<small>${esc(item.observacao)}</small>` : ""}</div>
                    <span class="valor">${dinheiro(precoCarrinho(item))}</span>
                    <button class="btn-icone" data-remover="${i}" aria-label="Remover">✕</button>
                  </div>`).join("")}
                <button class="btn primario grande largo" data-enviar>Enviar ${carrinho.reduce((s, i) => s + i.quantidade, 0)} item(ns) · ${dinheiro(totalCarrinho)}</button>
              </div>` : ""}
            <div class="itens-enviados">
              <h3>Itens da conta</h3>
              ${pedido.itens.length ? pedido.itens.map((item) => itemHtml(item, encerrado)).join("") : '<p class="sutil">Nenhum item ainda. Escolha no cardápio.</p>'}
            </div>
            <div class="totais">
              <div><span>Subtotal</span><b>${dinheiro(t.subtotal)}</b></div>
              ${t.servico ? `<div><span>Serviço (${(pedido.taxa_servico_pct / 10).toLocaleString("pt-BR")}%)</span><b>${dinheiro(t.servico)}</b></div>` : ""}
              ${t.taxa_entrega ? `<div><span>Entrega</span><b>${dinheiro(t.taxa_entrega)}</b></div>` : ""}
              ${t.desconto ? `<div><span>Desconto</span><b>− ${dinheiro(t.desconto)}</b></div>` : ""}
              <div class="total"><span>Total</span><b>${dinheiro(t.total)}</b></div>
              ${t.pago ? `<div><span>Pago</span><b>${dinheiro(t.pago)}</b></div><div class="falta"><span>Falta</span><b>${dinheiro(t.restante)}</b></div>` : ""}
              ${pedido.pessoas > 1 ? `<div class="sutil"><span>Por pessoa (${pedido.pessoas})</span><b>${dinheiro(Math.ceil(t.total / pedido.pessoas))}</b></div>` : ""}
            </div>
          </section>
        </div>
        ${carrinho.length && aba === "cardapio" ? `<button class="barra-enviar" data-ver-conta>Ver ${carrinho.reduce((s, i) => s + i.quantidade, 0)} item(ns) a enviar · ${dinheiro(totalCarrinho)} →</button>` : ""}
      </div>`;
    ligar();
  }

  function cardapioHtml() {
    const categorias = cardapio.categorias;
    if (!categoriaAtual || !categoria(categoriaAtual)) categoriaAtual = categorias[0]?.id;
    const termo = OP.normalizar(busca);
    const lista = cardapio.produtos.filter((p) => (termo ? OP.normalizar(`${p.nome} ${p.descricao || ""}`).includes(termo) : p.categoria_id === categoriaAtual));
    return `
      <input class="busca" type="search" placeholder="Buscar no cardápio" value="${esc(busca)}" data-busca />
      ${termo ? "" : `<div class="categorias">${categorias.map((c) => `<button class="chip ${c.id === categoriaAtual ? "ativo" : ""}" data-categoria="${c.id}">${esc(c.nome)}</button>`).join("")}</div>`}
      <div class="produtos">
        ${lista.map((p) => `
          <button class="produto ${p.disponivel ? "" : "esgotado"}" data-produto="${p.id}" ${p.disponivel ? "" : "disabled"}>
            <div><b>${esc(p.nome)}</b>${p.descricao ? `<small>${esc(p.descricao)}</small>` : ""}</div>
            <span>${p.disponivel ? dinheiro(p.preco) : "Esgotado"}</span>
          </button>`).join("") || '<p class="sutil">Nada encontrado.</p>'}
      </div>`;
  }

  function itemHtml(item, encerrado) {
    const [rotulo, classe] = STATUS[item.status];
    const podeEntregar = !encerrado && item.status === "pronto";
    const podeCancelar = !encerrado && item.status !== "cancelado" && (OP.pode("gerente", "caixa") || (item.status === "novo" && item.lancado_por === OP.estado.usuario.id));
    return `
      <div class="linha-item ${item.status === "cancelado" ? "riscado" : ""}">
        <span class="qtd">${item.quantidade}×</span>
        <div>
          <b>${esc(item.nome)}</b>
          ${item.observacao ? `<small>${esc(item.observacao)}</small>` : ""}
          <small class="meta"><span class="status-item ${classe}">${rotulo}</span>${item.setor_nome ? ` ${esc(item.setor_nome)}` : ""} · ${hora(item.lancado_em)}${item.cancelado_motivo && item.status === "cancelado" ? ` · ${esc(item.cancelado_motivo)}` : ""}</small>
        </div>
        <span class="valor">${dinheiro(item.quantidade * item.preco_unit)}</span>
        <div class="item-acoes">
          ${podeEntregar ? `<button class="btn pequeno sucesso" data-entregar="${item.id}">Entregue</button>` : ""}
          ${podeCancelar ? `<button class="btn-icone" data-cancelar="${item.id}" title="Cancelar item">✕</button>` : ""}
        </div>
      </div>`;
  }

  // ---------- Ações ----------

  function ligar() {
    $("[data-voltar]", raiz).addEventListener("click", () => OP.app.ir(origem));
    $$("[data-aba]", raiz).forEach((b) => b.addEventListener("click", () => { aba = b.dataset.aba; desenhar(); }));
    $("[data-ver-conta]", raiz)?.addEventListener("click", () => { aba = "conta"; desenhar(); });
    ligarCardapio();
    $$("[data-remover]", raiz).forEach((b) => b.addEventListener("click", () => { carrinho.splice(Number(b.dataset.remover), 1); salvarCarrinho(); desenhar(); }));
    $("[data-enviar]", raiz)?.addEventListener("click", enviar);
    $$("[data-entregar]", raiz).forEach((b) => b.addEventListener("click", () => mudarStatus(b.dataset.entregar, "entregue")));
    $$("[data-cancelar]", raiz).forEach((b) => b.addEventListener("click", () => cancelarItem(pedido.itens.find((i) => i.id === Number(b.dataset.cancelar)))));
    $$("[data-acao]", raiz).forEach((b) => b.addEventListener("click", () => acoes[b.dataset.acao]()));
  }

  function redesenharCardapio() {
    const painel = $(".painel-cardapio", raiz);
    if (!painel || !["aberto", "conta"].includes(pedido.status)) return;
    painel.innerHTML = cardapioHtml();
    ligarCardapio();
  }

  function ligarCardapio() {
    $("[data-busca]", raiz)?.addEventListener("input", (e) => {
      busca = e.target.value;
      const posicao = e.target.selectionStart;
      redesenharCardapio();
      const campo = $("[data-busca]", raiz);
      campo.focus();
      campo.setSelectionRange(posicao, posicao);
    });
    $$("[data-categoria]", raiz).forEach((b) => b.addEventListener("click", () => {
      categoriaAtual = Number(b.dataset.categoria);
      redesenharCardapio();
    }));
    $$("[data-produto]", raiz).forEach((b) => b.addEventListener("click", () => escolher(produto(Number(b.dataset.produto)))));
  }

  // Janela para quantidade, observação e (pizzas) meio a meio.
  function escolher(p) {
    const cat = categoria(p.categoria_id);
    const outrosSabores = cat?.meio_a_meio ? cardapio.produtos.filter((o) => o.categoria_id === p.categoria_id && o.id !== p.id && o.tamanho === p.tamanho && o.disponivel) : [];
    let quantidade = 1;
    let segundo = null;
    const obs = new Set();
    const dialogo = janela(`
      <div class="form-janela item-janela">
        <header class="janela-topo"><h2>${esc(p.nome)}</h2><button class="btn-icone" data-fechar aria-label="Fechar">✕</button></header>
        ${p.descricao ? `<p class="sutil">${esc(p.descricao)}</p>` : ""}
        ${outrosSabores.length ? `
          <div class="meio-a-meio">
            <div class="segmento"><button class="ativo" data-modo="inteira">Inteira</button><button data-modo="meia">Meio a meio</button></div>
            <div class="sabores is-hidden">
              <p class="sutil">Escolha o outro sabor (${esc(p.tamanho || "")}). Cobra o mais caro.</p>
              ${outrosSabores.map((o) => `<button class="sabor" data-sabor="${o.id}">${esc(o.nome.replace(/\s+(P|M|G|GG)$/i, ""))}<span>${dinheiro(o.preco)}</span></button>`).join("")}
            </div>
          </div>` : ""}
        <div class="quantidade"><button data-qtd="-1" aria-label="Menos">−</button><b>1</b><button data-qtd="1" aria-label="Mais">+</button></div>
        <div class="obs-rapidas">${OBS_RAPIDAS.map((o) => `<button class="chip" data-obs="${esc(o)}">${esc(o)}</button>`).join("")}</div>
        <label>Observação<input data-obs-livre placeholder="Ex.: sem tomate, ponto da carne…" maxlength="120" /></label>
        <footer><button class="btn primario grande largo" data-adicionar>Adicionar · <span data-preco>${dinheiro(p.preco)}</span></button></footer>
      </div>`, { classe: "janela-item" });
    const atualizar = () => {
      $(".quantidade b", dialogo).textContent = quantidade;
      const preco = Math.max(p.preco, segundo ? produto(segundo).preco : 0) * quantidade;
      $("[data-preco]", dialogo).textContent = dinheiro(preco);
    };
    $$("[data-qtd]", dialogo).forEach((b) => b.addEventListener("click", () => { quantidade = Math.max(1, Math.min(99, quantidade + Number(b.dataset.qtd))); atualizar(); }));
    $$("[data-obs]", dialogo).forEach((b) => b.addEventListener("click", () => {
      b.classList.toggle("ativo");
      if (obs.has(b.dataset.obs)) obs.delete(b.dataset.obs); else obs.add(b.dataset.obs);
    }));
    $$("[data-modo]", dialogo).forEach((b) => b.addEventListener("click", () => {
      $$("[data-modo]", dialogo).forEach((x) => x.classList.toggle("ativo", x === b));
      $(".sabores", dialogo).classList.toggle("is-hidden", b.dataset.modo !== "meia");
      if (b.dataset.modo === "inteira") { segundo = null; $$("[data-sabor]", dialogo).forEach((x) => x.classList.remove("ativo")); atualizar(); }
    }));
    $$("[data-sabor]", dialogo).forEach((b) => b.addEventListener("click", () => {
      segundo = Number(b.dataset.sabor);
      $$("[data-sabor]", dialogo).forEach((x) => x.classList.toggle("ativo", x === b));
      atualizar();
    }));
    $("[data-adicionar]", dialogo).addEventListener("click", () => {
      const meia = $("[data-modo='meia'].ativo", dialogo);
      if (meia && !segundo) return aviso("Escolha o outro sabor.", "erro");
      const livre = $("[data-obs-livre]", dialogo).value.trim();
      carrinho.push({
        produto_id: p.id,
        sabores: segundo ? [p.id, segundo] : null,
        quantidade,
        observacao: [...obs, livre].filter(Boolean).join(", "),
      });
      salvarCarrinho();
      dialogo.close();
      desenhar();
      aviso("Adicionado. Envie para a cozinha quando terminar.");
    });
  }

  async function enviar() {
    const botao = $("[data-enviar]", raiz);
    botao.disabled = true;
    try {
      pedido = await api("POST", `/api/pedidos/${pedido.id}/itens`, {
        itens: carrinho.map((i) => (i.sabores ? { sabores: i.sabores, quantidade: i.quantidade, observacao: i.observacao } : { produto_id: i.produto_id, quantidade: i.quantidade, observacao: i.observacao })),
      });
      carrinho = [];
      salvarCarrinho();
      aviso("Pedido enviado para a cozinha.");
      aba = "conta";
      desenhar();
    } catch (erro) {
      aviso(erro.message, "erro");
      botao.disabled = false;
    }
  }

  async function mudarStatus(itemId, status) {
    try {
      await api("POST", `/api/itens/${itemId}/status`, { status });
      await recarregar();
    } catch (erro) {
      aviso(erro.message, "erro");
    }
  }

  function cancelarItem(item) {
    const precisaMotivo = item.status !== "novo";
    OP.formulario({
      titulo: `Cancelar ${item.quantidade}× ${item.nome}`,
      intro: precisaMotivo ? "O item já foi para o preparo. O cancelamento fica registrado." : "",
      campos: [{ nome: "motivo", rotulo: "Motivo", tipo: "textarea", obrigatorio: precisaMotivo, largo: true, placeholder: "Ex.: cliente desistiu, lançado errado" }],
      botao: "Cancelar item",
      async salvar(dados) {
        pedido = await api("POST", `/api/itens/${item.id}/cancelar`, { motivo: dados.motivo });
        desenhar();
      },
    });
  }

  const acoes = {
    async conta() {
      pedido = await api("POST", `/api/pedidos/${pedido.id}/conta`, {});
      aviso("Conta pedida. O caixa foi avisado.");
      desenhar();
    },
    async transferir() {
      const mesas = await api("GET", "/api/mesas");
      OP.formulario({
        titulo: "Transferir ou juntar mesa",
        intro: "Se a mesa de destino estiver ocupada, as contas são juntadas.",
        campos: [{ nome: "mesa_id", rotulo: "Mesa de destino", tipo: "select", largo: true, opcoes: mesas.filter((m) => m.id !== pedido.mesa_id).map((m) => ({ valor: m.id, rotulo: `Mesa ${m.numero}${m.situacao !== "livre" ? " (ocupada: juntar)" : ""}` })) }],
        botao: "Transferir",
        async salvar(dados) {
          if (!dados.mesa_id) throw new Error("Escolha a mesa.");
          const novo = await api("POST", `/api/pedidos/${pedido.id}/transferir`, { mesa_id: Number(dados.mesa_id) });
          OP.app.ir(`pedido/${novo.id}/${origem}`);
        },
      });
    },
    async liberar() {
      if (!(await confirmar(pedido.tipo === "mesa" ? "Liberar a mesa sem nenhum item?" : "Cancelar este pedido vazio?"))) return;
      await api("POST", `/api/pedidos/${pedido.id}/cancelar`, {});
      OP.app.ir(origem);
    },
    cancelar() {
      OP.formulario({
        titulo: "Cancelar pedido inteiro",
        intro: "Todos os itens serão cancelados. Pagamentos precisam ser estornados antes.",
        campos: [{ nome: "motivo", rotulo: "Motivo", tipo: "textarea", obrigatorio: true, largo: true }],
        botao: "Cancelar pedido",
        async salvar(dados) {
          await api("POST", `/api/pedidos/${pedido.id}/cancelar`, { motivo: dados.motivo });
          OP.app.ir(origem);
        },
      });
    },
    receber() {
      OP.pagamento.abrir(pedido, async (atualizado) => {
        pedido = atualizado;
        if (pedido.status === "fechado") {
          sessionStorage.removeItem(chaveCarrinho());
          OP.app.ir(origem);
        } else desenhar();
      });
    },
    imprimir() {
      OP.pagamento.imprimirConta(pedido);
    },
  };

  async function recarregar() {
    pedido = await api("GET", `/api/pedidos/${pedido.id}`);
    desenhar();
  }

  OP.telas.pedido = {
    async abrir(conteudo, params) {
      raiz = conteudo;
      origem = params[1] || "salao";
      busca = "";
      aba = window.innerWidth < 900 && OP.pode("garcom") ? "cardapio" : "conta";
      [pedido, cardapio] = await Promise.all([api("GET", `/api/pedidos/${Number(params[0])}`), api("GET", "/api/cardapio")]);
      try { carrinho = JSON.parse(sessionStorage.getItem(chaveCarrinho()) || "[]"); } catch { carrinho = []; }
      desenhar();
    },
    aoEvento(tipo, dados) {
      if (tipo === "pedido" && dados.id === pedido?.id && !document.querySelector("dialog[open]")) recarregar().catch(() => {});
      if (tipo === "cozinha" && !document.querySelector("dialog[open]")) recarregar().catch(() => {});
      if (tipo === "cardapio") api("GET", "/api/cardapio").then((c) => { cardapio = c; if (!document.querySelector("dialog[open]")) desenhar(); });
    },
  };
})();

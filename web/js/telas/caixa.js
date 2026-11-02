"use strict";

// Caixa: abertura, sangria, suprimento, contas aguardando pagamento e fechamento com conferência.
(() => {
  const { $, $$, esc, api, dinheiro, hora, dataHora, tempoDesde, aviso, FORMA } = OP;
  let raiz = null;

  async function carregar() {
    const [estado, pedidos] = await Promise.all([api("GET", "/api/caixa"), api("GET", "/api/pedidos?status=abertos")]);
    const aberta = estado.aberta;
    const aguardando = pedidos.filter((p) => p.status === "conta" || (p.tipo !== "mesa" && p.totais.total > 0));
    raiz.innerHTML = `
      <div class="titulo-tela">
        <div><h1>Caixa</h1><p>${aberta ? `Aberto por ${esc(aberta.aberto_por_nome)} às ${hora(aberta.aberto_em)} (${tempoDesde(aberta.aberto_em)})` : "Caixa fechado"}</p></div>
        <div class="acoes-linha">
          ${aberta ? `
            <button class="btn" data-mov="suprimento">+ Suprimento</button>
            <button class="btn" data-mov="sangria">− Sangria</button>
            <button class="btn primario" data-fechar-caixa>Fechar caixa</button>` : '<button class="btn primario grande" data-abrir>Abrir caixa</button>'}
        </div>
      </div>
      ${aberta ? `
        <div class="numeros">
          <div class="numero destaque"><small>Vendas no caixa</small><b>${dinheiro(aberta.vendas)}</b><span>${aberta.pedidosFechados} conta(s) · ticket ${dinheiro(aberta.ticketMedio)}</span></div>
          ${Object.entries(FORMA).map(([id, rotulo]) => `<div class="numero"><small>${rotulo}</small><b>${dinheiro(aberta.porForma[id])}</b></div>`).join("")}
          <div class="numero"><small>Dinheiro na gaveta (esperado)</small><b>${dinheiro(aberta.dinheiroEsperado)}</b><span>troco inicial ${dinheiro(aberta.valor_inicial)}</span></div>
        </div>
        <div class="duas-colunas">
          <section class="cartao">
            <h2>Aguardando pagamento</h2>
            ${aguardando.length ? aguardando.map((p) => `
              <button class="linha-clicavel" data-pedido="${p.id}" data-origem="${p.tipo === "mesa" ? "salao" : p.tipo}">
                <b>${p.tipo === "mesa" ? `Mesa ${p.mesa_numero}` : p.tipo === "balcao" ? `Balcão #${p.numero}` : `Delivery #${p.numero}`}${p.cliente_nome ? ` · ${esc(p.cliente_nome)}` : ""}</b>
                <span>${p.status === "conta" ? '<em class="txt-conta">pediu a conta</em> · ' : ""}${tempoDesde(p.aberto_em)}</span>
                <strong>${dinheiro(p.totais.restante)}</strong>
              </button>`).join("") : '<p class="sutil">Nenhuma conta aguardando.</p>'}
          </section>
          <section class="cartao">
            <h2>Movimentos do caixa</h2>
            ${aberta.movimentos.length ? aberta.movimentos.map((m) => `<div class="linha"><span>${m.tipo === "sangria" ? "Sangria" : "Suprimento"} · ${hora(m.criado_em)} · ${esc(m.motivo || "")} (${esc(m.usuario_nome || "")})</span><b>${m.tipo === "sangria" ? "−" : "+"} ${dinheiro(m.valor)}</b></div>`).join("") : '<p class="sutil">Nenhuma sangria ou suprimento.</p>'}
          </section>
        </div>` : ""}
      <section class="cartao">
        <h2>Fechamentos anteriores</h2>
        ${estado.anteriores.length ? `<table class="tabela"><thead><tr><th>Abertura</th><th>Fechamento</th><th>Vendas</th><th>Dinheiro esperado</th><th>Contado</th><th>Diferença</th><th></th></tr></thead><tbody>
          ${estado.anteriores.map((s) => `<tr><td>${dataHora(s.aberto_em)} · ${esc(s.aberto_por_nome || "")}</td><td>${dataHora(s.fechado_em)} · ${esc(s.fechado_por_nome || "")}</td><td>${dinheiro(s.vendas)}</td><td>${dinheiro(s.dinheiroEsperado)}</td><td>${dinheiro(s.valor_contado)}</td>
            <td class="${s.diferenca < 0 ? "negativo" : s.diferenca > 0 ? "positivo" : ""}">${dinheiro(s.diferenca)}</td><td><button class="link" data-imprimir-sessao="${s.id}">imprimir</button></td></tr>`).join("")}
        </tbody></table>` : '<p class="sutil">Nenhum fechamento ainda.</p>'}
      </section>`;
    ligar(estado);
  }

  function ligar(estado) {
    $("[data-abrir]", raiz)?.addEventListener("click", () => OP.formulario({
      titulo: "Abrir caixa",
      campos: [{ nome: "valor_inicial", rotulo: "Troco inicial na gaveta (R$)", tipo: "dinheiro", obrigatorio: true }],
      valores: { valor_inicial: 0 },
      botao: "Abrir caixa",
      async salvar(dados) {
        await api("POST", "/api/caixa/abrir", { valor_inicial: dados.valor_inicial });
        aviso("Caixa aberto.");
        carregar();
      },
    }));
    $$("[data-mov]", raiz).forEach((b) => b.addEventListener("click", () => OP.formulario({
      titulo: b.dataset.mov === "sangria" ? "Sangria (retirada de dinheiro)" : "Suprimento (entrada de troco)",
      campos: [{ nome: "valor", rotulo: "Valor (R$)", tipo: "dinheiro", obrigatorio: true }, { nome: "motivo", rotulo: "Motivo", obrigatorio: true, largo: true, placeholder: b.dataset.mov === "sangria" ? "Ex.: depósito no banco, pagamento de fornecedor" : "Ex.: reforço de troco" }],
      async salvar(dados) {
        await api("POST", "/api/caixa/movimento", { tipo: b.dataset.mov, ...dados });
        carregar();
      },
    })));
    $("[data-fechar-caixa]", raiz)?.addEventListener("click", () => fechar(estado.aberta, false));
    $$("[data-pedido]", raiz).forEach((b) => b.addEventListener("click", () => OP.app.ir(`pedido/${b.dataset.pedido}/${b.dataset.origem}`)));
    $$("[data-imprimir-sessao]", raiz).forEach((b) => b.addEventListener("click", () => imprimirFechamento(estado.anteriores.find((s) => s.id === Number(b.dataset.imprimirSessao)))));
  }

  function fechar(aberta, confirmarPendentes) {
    OP.formulario({
      titulo: "Fechar caixa",
      intro: `Conte o dinheiro da gaveta. O sistema espera <b>${dinheiro(aberta.dinheiroEsperado)}</b>.`,
      campos: [{ nome: "valor_contado", rotulo: "Dinheiro contado (R$)", tipo: "dinheiro", obrigatorio: true }, { nome: "observacao", rotulo: "Observação", tipo: "textarea", largo: true }],
      botao: "Fechar caixa",
      async salvar(dados) {
        try {
          const resumo = await api("POST", "/api/caixa/fechar", { ...dados, confirmar_pendentes: confirmarPendentes });
          const dif = resumo.diferenca;
          aviso(dif === 0 ? "Caixa fechado e conferido." : `Caixa fechado com diferença de ${dinheiro(dif)}.`, dif === 0 ? "ok" : "erro");
          imprimirFechamento(resumo);
          carregar();
        } catch (erro) {
          if (/conta\(s\) aberta/.test(erro.message) && (await OP.confirmar(erro.message, { titulo: "Contas abertas", botao: "Fechar mesmo assim" }))) {
            const resumo = await api("POST", "/api/caixa/fechar", { ...dados, confirmar_pendentes: true });
            imprimirFechamento(resumo);
            carregar();
            return;
          }
          throw erro;
        }
      },
    });
  }

  function imprimirFechamento(s) {
    const area = document.createElement("div");
    area.className = "impressao";
    area.innerHTML = `
      <h1>Fechamento de caixa</h1>
      <p>${esc(OP.estado.restaurante?.nome || "")}<br>Abertura: ${dataHora(s.aberto_em)} (${esc(s.aberto_por_nome || "")})<br>Fechamento: ${dataHora(s.fechado_em)} (${esc(s.fechado_por_nome || "")})</p>
      <table>
        ${Object.entries(FORMA).map(([id, rotulo]) => `<tr><td>${rotulo}</td><td>${dinheiro(s.porForma[id])}</td></tr>`).join("")}
        <tr class="forte"><td>Total de vendas</td><td>${dinheiro(s.vendas)}</td></tr>
        <tr><td>Contas fechadas</td><td>${s.pedidosFechados}</td></tr>
        <tr><td>Troco inicial</td><td>${dinheiro(s.valor_inicial)}</td></tr>
        <tr><td>Suprimentos</td><td>${dinheiro(s.suprimentos)}</td></tr>
        <tr><td>Sangrias</td><td>- ${dinheiro(s.sangrias)}</td></tr>
        <tr class="forte"><td>Dinheiro esperado</td><td>${dinheiro(s.dinheiroEsperado)}</td></tr>
        <tr><td>Dinheiro contado</td><td>${dinheiro(s.valor_contado)}</td></tr>
        <tr class="forte"><td>Diferença</td><td>${dinheiro(s.diferenca)}</td></tr>
      </table>
      ${s.observacao ? `<p>Obs.: ${esc(s.observacao)}</p>` : ""}
      <p class="rodape">Operatto by KAI</p>`;
    document.body.appendChild(area);
    document.body.classList.add("imprimindo");
    window.print();
    setTimeout(() => { document.body.classList.remove("imprimindo"); area.remove(); }, 500);
  }

  OP.telas.caixa = {
    async abrir(conteudo) {
      raiz = conteudo;
      await carregar();
    },
    aoEvento(tipo) {
      if (["caixa", "pedido", "mesas"].includes(tipo) && !document.querySelector("dialog[open]")) carregar().catch(() => {});
    },
  };
})();

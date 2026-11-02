"use strict";

// Recebimento da conta: formas de pagamento, divisão, troco, serviço, desconto e impressão da conta.
(() => {
  const { $, $$, esc, api, dinheiro, lerDinheiro, paraCampo, dataHora, aviso, janela, FORMA } = OP;

  function abrir(pedidoInicial, aoAtualizar) {
    let pedido = pedidoInicial;
    let forma = "pix";
    let dividir = 1;
    const dialogo = janela('<div class="form-janela pagamento"></div>', { classe: "janela-larga" });
    const caixa = $(".pagamento", dialogo);

    async function desenhar() {
      const estadoCaixa = await api("GET", "/api/caixa").catch(() => ({ aberta: null }));
      const t = pedido.totais;
      const sugerido = dividir > 1 ? Math.min(t.restante, Math.ceil(t.total / dividir)) : t.restante;
      const fechado = pedido.status === "fechado";
      caixa.innerHTML = `
        <header class="janela-topo"><h2>Receber · ${esc(pedido.tipo === "mesa" ? `Mesa ${pedido.mesa_numero}` : `#${pedido.numero}`)}</h2><button class="btn-icone" data-fechar aria-label="Fechar">✕</button></header>
        ${!estadoCaixa.aberta ? '<div class="alerta">O caixa está fechado. Abra o caixa para receber.<button class="btn pequeno" data-abrir-caixa>Abrir caixa</button></div>' : ""}
        <div class="pagamento-grade">
          <div class="resumo-conta">
            <div><span>Subtotal</span><b>${dinheiro(t.subtotal)}</b></div>
            <label class="check"><input type="checkbox" data-servico ${pedido.taxa_servico_pct ? "checked" : ""} ${fechado ? "disabled" : ""}/> Serviço ${pedido.taxa_servico_pct ? `(${pedido.taxa_servico_pct / 10}%)` : ""}<b>${dinheiro(t.servico)}</b></label>
            ${t.taxa_entrega ? `<div><span>Entrega</span><b>${dinheiro(t.taxa_entrega)}</b></div>` : ""}
            <div><span>Desconto ${fechado ? "" : '<button class="link" data-desconto>alterar</button>'}</span><b>${t.desconto ? `− ${dinheiro(t.desconto)}` : "—"}</b></div>
            <div class="total"><span>Total</span><b>${dinheiro(t.total)}</b></div>
            <div><span>Pago</span><b>${dinheiro(t.pago)}</b></div>
            <div class="falta"><span>Falta</span><b>${dinheiro(t.restante)}</b></div>
            ${pedido.pagamentos.length ? `<h4>Pagamentos</h4>${pedido.pagamentos.map((pg) => `
              <div class="linha-pagamento ${pg.estornado_em ? "riscado" : ""}">
                <span>${FORMA[pg.forma]} · ${dataHora(pg.criado_em)}${pg.troco ? ` · troco ${dinheiro(pg.troco)}` : ""}</span>
                <b>${dinheiro(pg.valor)}</b>
                ${!pg.estornado_em ? `<button class="link" data-estornar="${pg.id}">estornar</button>` : "<small>estornado</small>"}
              </div>`).join("")}` : ""}
          </div>
          ${fechado ? `<div class="pago-ok"><span>✓</span><b>Conta paga</b>${pedido.ultimoTroco ? `<p>Troco: <strong>${dinheiro(pedido.ultimoTroco)}</strong></p>` : ""}<button class="btn" data-imprimir>Imprimir conta</button><button class="btn primario" data-fechar>Concluir</button></div>` : `
          <div class="receber">
            <div class="dividir">Dividir por <button data-dividir="-1">−</button><b>${dividir}</b><button data-dividir="1">+</button>${dividir > 1 ? `<span>${dinheiro(Math.ceil(t.total / dividir))} por pessoa</span>` : ""}</div>
            <div class="formas">${Object.entries(FORMA).map(([id, rotulo]) => `<button class="forma ${forma === id ? "ativo" : ""}" data-forma="${id}">${rotulo}</button>`).join("")}</div>
            <label>${forma === "dinheiro" ? "Valor da conta a receber" : "Valor"}<input data-valor inputmode="decimal" value="${paraCampo(sugerido)}"/></label>
            ${forma === "dinheiro" ? `
              <label>Dinheiro recebido do cliente<input data-recebido inputmode="decimal" placeholder="${paraCampo(sugerido)}"/></label>
              <div class="notas">${[sugerido, 2000, 5000, 10000, 20000].filter((v, i, a) => v >= sugerido && a.indexOf(v) === i).slice(0, 4).map((v) => `<button class="chip" data-nota="${v}">${v === sugerido ? "Exato" : dinheiro(v)}</button>`).join("")}</div>
              <p class="troco">Troco: <b data-troco>${dinheiro(0)}</b></p>` : ""}
            <p class="erro" role="alert"></p>
            <button class="btn primario grande largo" data-confirmar ${estadoCaixa.aberta ? "" : "disabled"}>Confirmar ${FORMA[forma]}</button>
          </div>`}
        </div>`;
      ligar(sugerido);
    }

    function ligar(sugerido) {
      $("[data-abrir-caixa]", caixa)?.addEventListener("click", () => { dialogo.close(); OP.app.ir("caixa"); });
      $$("[data-forma]", caixa).forEach((b) => b.addEventListener("click", () => { forma = b.dataset.forma; desenhar(); }));
      $$("[data-dividir]", caixa).forEach((b) => b.addEventListener("click", () => { dividir = Math.max(1, Math.min(30, dividir + Number(b.dataset.dividir))); desenhar(); }));
      $("[data-imprimir]", caixa)?.addEventListener("click", () => imprimirConta(pedido));
      const recebido = $("[data-recebido]", caixa);
      const atualizarTroco = () => {
        const conta = lerDinheiro($("[data-valor]", caixa).value) || 0;
        const dado = lerDinheiro(recebido.value) ?? conta;
        $("[data-troco]", caixa).textContent = dinheiro(Math.max(0, dado - conta));
      };
      recebido?.addEventListener("input", atualizarTroco);
      $$("[data-nota]", caixa).forEach((b) => b.addEventListener("click", () => { recebido.value = paraCampo(Number(b.dataset.nota)); atualizarTroco(); }));
      $("[data-servico]", caixa)?.addEventListener("change", (e) => ajustar({ taxa_servico_pct: e.target.checked ? OP.estado.sistema.taxaServicoPct || 100 : 0 }));
      $("[data-desconto]", caixa)?.addEventListener("click", () => OP.formulario({
        titulo: "Desconto",
        campos: [{ nome: "desconto", rotulo: "Valor do desconto (R$)", tipo: "dinheiro", obrigatorio: true }, { nome: "motivo", rotulo: "Motivo", obrigatorio: true, largo: true }],
        valores: { desconto: pedido.desconto },
        async salvar(dados) { await ajustar({ desconto: dados.desconto, motivo: dados.motivo }); },
      }));
      $$("[data-estornar]", caixa).forEach((b) => b.addEventListener("click", () => OP.formulario({
        titulo: "Estornar pagamento",
        campos: [{ nome: "motivo", rotulo: "Motivo", tipo: "textarea", obrigatorio: true, largo: true }],
        botao: "Estornar",
        async salvar(dados) {
          pedido = await api("POST", `/api/pagamentos/${b.dataset.estornar}/estornar`, { motivo: dados.motivo });
          aoAtualizar(pedido);
          desenhar();
        },
      })));
      $("[data-confirmar]", caixa)?.addEventListener("click", async (e) => {
        const erro = $(".erro", caixa);
        erro.textContent = "";
        const valor = lerDinheiro($("[data-valor]", caixa).value);
        if (!valor) return (erro.textContent = "Informe o valor.");
        const corpo = { forma, valor };
        if (forma === "dinheiro") {
          corpo.recebido = lerDinheiro($("[data-recebido]", caixa).value) ?? valor;
          if (corpo.recebido < valor) return (erro.textContent = "O dinheiro recebido é menor que o valor.");
        }
        e.target.disabled = true;
        try {
          const resultado = await api("POST", `/api/pedidos/${pedido.id}/pagamentos`, corpo);
          pedido = { ...resultado, ultimoTroco: resultado.troco };
          aoAtualizar(pedido);
          if (resultado.troco) aviso(`Troco: ${dinheiro(resultado.troco)}`);
          if (resultado.fechou) OP.bipe("pronto");
          desenhar();
        } catch (problema) {
          erro.textContent = problema.message;
          e.target.disabled = false;
        }
      });
    }

    async function ajustar(dados) {
      pedido = await api("POST", `/api/pedidos/${pedido.id}/ajustes`, dados);
      aoAtualizar(pedido);
      await desenhar();
    }

    desenhar();
  }

  // Conta impressa (impressora térmica de 80 mm ou comum).
  function imprimirConta(pedido) {
    const t = pedido.totais;
    const area = document.createElement("div");
    area.className = "impressao";
    area.innerHTML = `
      <h1>${esc(OP.estado.restaurante?.nome || "")}</h1>
      <p>${pedido.tipo === "mesa" ? `Mesa ${pedido.mesa_numero}` : pedido.tipo === "balcao" ? "Balcão" : "Delivery"} · Pedido #${pedido.numero}<br>${new Date().toLocaleString("pt-BR")}</p>
      ${pedido.tipo === "delivery" ? `<p>${esc(pedido.cliente_nome || "")}<br>${esc(pedido.entrega_endereco || "")} ${esc(pedido.entrega_bairro || "")}<br>${esc(pedido.cliente?.telefone || "")}</p>` : ""}
      <table>${pedido.itens.filter((i) => i.status !== "cancelado").map((i) => `<tr><td>${i.quantidade}x ${esc(i.nome)}</td><td>${dinheiro(i.quantidade * i.preco_unit)}</td></tr>`).join("")}</table>
      <table class="totais-impressao">
        <tr><td>Subtotal</td><td>${dinheiro(t.subtotal)}</td></tr>
        ${t.servico ? `<tr><td>Serviço (${pedido.taxa_servico_pct / 10}%)</td><td>${dinheiro(t.servico)}</td></tr>` : ""}
        ${t.taxa_entrega ? `<tr><td>Entrega</td><td>${dinheiro(t.taxa_entrega)}</td></tr>` : ""}
        ${t.desconto ? `<tr><td>Desconto</td><td>- ${dinheiro(t.desconto)}</td></tr>` : ""}
        <tr class="forte"><td>TOTAL</td><td>${dinheiro(t.total)}</td></tr>
        ${pedido.pessoas > 1 ? `<tr><td>Por pessoa (${pedido.pessoas})</td><td>${dinheiro(Math.ceil(t.total / pedido.pessoas))}</td></tr>` : ""}
        ${t.pago ? `<tr><td>Pago</td><td>${dinheiro(t.pago)}</td></tr>` : ""}
      </table>
      <p class="rodape">Não é documento fiscal · Operatto by KAI</p>`;
    document.body.appendChild(area);
    document.body.classList.add("imprimindo");
    window.print();
    setTimeout(() => {
      document.body.classList.remove("imprimindo");
      area.remove();
    }, 500);
  }

  OP.pagamento = { abrir, imprimirConta };
})();

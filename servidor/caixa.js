// Caixa: abertura, sangria, suprimento, fechamento com conferência e resumo de vendas.
const { registrar, exigir } = require("./acesso");
const { FORMAS } = require("./pedidos");

const inteiro = (valor) => (Number.isInteger(Number(valor)) ? Number(valor) : NaN);

function criarCaixa(banco, avisar, pedidos) {
  function resumoSessao(sessao) {
    const porForma = Object.fromEntries(FORMAS.map((forma) => [forma, 0]));
    banco.todos("select forma, sum(valor) as total from pagamentos where caixa_sessao_id = ? and estornado_em is null group by forma", sessao.id)
      .forEach((linha) => { porForma[linha.forma] = linha.total; });
    const movimentos = banco.todos("select m.*, u.nome as usuario_nome from caixa_movimentos m left join usuarios u on u.id = m.usuario_id where sessao_id = ? order by m.id", sessao.id);
    const sangrias = movimentos.filter((m) => m.tipo === "sangria").reduce((soma, m) => soma + m.valor, 0);
    const suprimentos = movimentos.filter((m) => m.tipo === "suprimento").reduce((soma, m) => soma + m.valor, 0);
    const vendas = Object.values(porForma).reduce((soma, v) => soma + v, 0);
    const pedidosFechados = banco.um("select count(*) as n from pedidos where caixa_sessao_id = ? and status = 'fechado'", sessao.id).n;
    const dinheiroEsperado = sessao.valor_inicial + porForma.dinheiro + suprimentos - sangrias;
    return {
      ...sessao,
      aberto_por_nome: banco.um("select nome from usuarios where id = ?", sessao.aberto_por)?.nome,
      fechado_por_nome: sessao.fechado_por ? banco.um("select nome from usuarios where id = ?", sessao.fechado_por)?.nome : null,
      porForma, movimentos, sangrias, suprimentos, vendas, pedidosFechados,
      ticketMedio: pedidosFechados ? Math.round(vendas / pedidosFechados) : 0,
      dinheiroEsperado,
      diferenca: sessao.valor_contado === null || sessao.valor_contado === undefined ? null : sessao.valor_contado - dinheiroEsperado,
    };
  }

  function rotas(rota) {
    rota("GET", "/api/caixa", { papeis: ["gerente", "caixa"] }, () => {
      const aberta = pedidos.sessaoCaixaAberta();
      return {
        aberta: aberta ? resumoSessao(aberta) : null,
        anteriores: banco.todos("select * from caixa_sessoes where fechado_em is not null order by id desc limit 10").map(resumoSessao),
        contasAbertas: banco.um("select count(*) as n from pedidos where status in ('aberto', 'conta')").n,
      };
    });

    rota("POST", "/api/caixa/abrir", { papeis: ["gerente", "caixa"] }, ({ corpo, sessao }) => {
      exigir(!pedidos.sessaoCaixaAberta(), "O caixa já está aberto.", 409);
      const valor = inteiro(corpo.valor_inicial ?? 0);
      exigir(valor >= 0, "Valor inicial inválido.");
      const r = banco.exec("insert into caixa_sessoes (aberto_por, aberto_em, valor_inicial) values (?, ?, ?)", sessao.usuario.id, Date.now(), valor);
      registrar(banco, sessao, "Abertura de caixa", `Troco inicial ${(valor / 100).toFixed(2)}`);
      avisar("caixa");
      return resumoSessao(banco.um("select * from caixa_sessoes where id = ?", Number(r.lastInsertRowid)));
    });

    rota("POST", "/api/caixa/movimento", { papeis: ["gerente", "caixa"] }, ({ corpo, sessao }) => {
      const aberta = pedidos.sessaoCaixaAberta();
      exigir(aberta, "O caixa está fechado.", 409);
      exigir(["sangria", "suprimento"].includes(corpo.tipo), "Tipo inválido.");
      const valor = inteiro(corpo.valor);
      exigir(valor > 0, "Informe o valor.");
      exigir(String(corpo.motivo || "").trim(), "Informe o motivo.");
      if (corpo.tipo === "sangria") exigir(valor <= resumoSessao(aberta).dinheiroEsperado, "A sangria é maior que o dinheiro em caixa.");
      banco.exec("insert into caixa_movimentos (sessao_id, tipo, valor, motivo, usuario_id, criado_em) values (?, ?, ?, ?, ?, ?)", aberta.id, corpo.tipo, valor, corpo.motivo.trim(), sessao.usuario.id, Date.now());
      registrar(banco, sessao, corpo.tipo === "sangria" ? "Sangria" : "Suprimento", `${(valor / 100).toFixed(2)} · ${corpo.motivo.trim()}`);
      avisar("caixa");
      return resumoSessao(aberta);
    });

    rota("POST", "/api/caixa/fechar", { papeis: ["gerente", "caixa"] }, ({ corpo, sessao }) => {
      const aberta = pedidos.sessaoCaixaAberta();
      exigir(aberta, "O caixa já está fechado.", 409);
      const contado = inteiro(corpo.valor_contado);
      exigir(contado >= 0, "Informe o dinheiro contado na gaveta.");
      const pendentes = banco.um("select count(*) as n from pedidos where status in ('aberto', 'conta')").n;
      exigir(!pendentes || corpo.confirmar_pendentes, `Ainda há ${pendentes} conta(s) aberta(s). Confirme para fechar mesmo assim.`, 409);
      banco.exec("update caixa_sessoes set fechado_por = ?, fechado_em = ?, valor_contado = ?, observacao = ? where id = ?", sessao.usuario.id, Date.now(), contado, corpo.observacao || null, aberta.id);
      const resumo = resumoSessao(banco.um("select * from caixa_sessoes where id = ?", aberta.id));
      registrar(banco, sessao, "Fechamento de caixa", `Vendas ${(resumo.vendas / 100).toFixed(2)} · diferença ${(resumo.diferenca / 100).toFixed(2)}`);
      avisar("caixa");
      return resumo;
    });

    // Resumo do dia para o painel do gerente.
    rota("GET", "/api/resumo-dia", { papeis: ["gerente", "caixa"] }, () => {
      const inicio = pedidos.inicioDoDia();
      const fechados = banco.todos("select * from pedidos where status = 'fechado' and fechado_em >= ?", inicio);
      const vendas = fechados.reduce((soma, p) => soma + pedidos.totais(p).total, 0);
      const porHora = Array.from({ length: 24 }, () => 0);
      fechados.forEach((p) => { porHora[new Date(p.fechado_em).getHours()] += pedidos.totais(p).total; });
      const maisVendidos = banco.todos(`select i.nome, sum(i.quantidade) as quantidade, sum(i.quantidade * i.preco_unit) as valor from pedido_itens i join pedidos p on p.id = i.pedido_id
        where p.status = 'fechado' and p.fechado_em >= ? and i.status != 'cancelado' group by i.nome order by quantidade desc limit 8`, inicio);
      return {
        vendas,
        pedidos: fechados.length,
        ticketMedio: fechados.length ? Math.round(vendas / fechados.length) : 0,
        porTipo: ["mesa", "balcao", "delivery"].map((tipo) => ({ tipo, total: fechados.filter((p) => p.tipo === tipo).reduce((s, p) => s + pedidos.totais(p).total, 0) })),
        porHora,
        maisVendidos,
        mesasOcupadas: banco.um("select count(*) as n from pedidos where tipo = 'mesa' and status in ('aberto', 'conta')").n,
        mesasTotal: banco.um("select count(*) as n from mesas where ativo = 1").n,
        cozinhaPendentes: banco.um("select count(*) as n from pedido_itens where status in ('novo', 'preparo')").n,
        cancelados: banco.um("select count(*) as n from pedido_itens i join pedidos p on p.id = i.pedido_id where i.status = 'cancelado' and p.aberto_em >= ?", inicio).n,
      };
    });
  }

  return { rotas };
}

module.exports = { criarCaixa };

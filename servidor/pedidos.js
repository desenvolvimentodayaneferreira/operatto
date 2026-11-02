// Pedidos (mesa, balcão e delivery), itens, cozinha, pagamentos e baixa automática do estoque.
const { registrar, exigir } = require("./acesso");
const { ErroHttp } = require("./http");

const FORMAS = ["dinheiro", "pix", "debito", "credito", "vale"];
const ABERTOS = "('aberto', 'conta')";
const TAXA_SERVICO_PADRAO = 100; // 10,0%

const inteiro = (valor) => (Number.isInteger(Number(valor)) ? Number(valor) : NaN);

function inicioDoDia(agora = new Date()) {
  return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
}

function criarPedidos(banco, avisar) {
  // ---------- Consultas ----------

  function totais(pedido) {
    const itens = banco.um("select coalesce(sum(quantidade * preco_unit), 0) as subtotal from pedido_itens where pedido_id = ? and status != 'cancelado'", pedido.id);
    const pagos = banco.um("select coalesce(sum(valor), 0) as pago from pagamentos where pedido_id = ? and estornado_em is null", pedido.id);
    const subtotal = itens.subtotal;
    const servico = Math.round((subtotal * pedido.taxa_servico_pct) / 1000);
    const total = Math.max(0, subtotal + servico + pedido.taxa_entrega - pedido.desconto);
    return { subtotal, servico, taxa_entrega: pedido.taxa_entrega, desconto: pedido.desconto, total, pago: pagos.pago, restante: Math.max(0, total - pagos.pago) };
  }

  function pedidoCompleto(id) {
    const pedido = banco.um(`select p.*, m.numero as mesa_numero, g.nome as garcom_nome, e.nome as entregador_nome
      from pedidos p left join mesas m on m.id = p.mesa_id left join usuarios g on g.id = p.garcom_id left join usuarios e on e.id = p.entregador_id where p.id = ?`, id);
    if (!pedido) throw new ErroHttp(404, "Pedido não encontrado.");
    pedido.itens = banco.todos(`select i.*, s.nome as setor_nome, u.nome as lancado_por_nome from pedido_itens i
      left join setores s on s.id = i.setor_id left join usuarios u on u.id = i.lancado_por where i.pedido_id = ? order by i.id`, id)
      .map((item) => ({ ...item, sabores: item.sabores ? JSON.parse(item.sabores) : null }));
    pedido.pagamentos = banco.todos("select pg.*, u.nome as usuario_nome from pagamentos pg left join usuarios u on u.id = pg.usuario_id where pedido_id = ? order by pg.id", id);
    pedido.totais = totais(pedido);
    if (pedido.cliente_id) pedido.cliente = banco.um("select * from clientes where id = ?", pedido.cliente_id);
    return pedido;
  }

  function sessaoCaixaAberta() {
    return banco.um("select * from caixa_sessoes where fechado_em is null order by id desc limit 1");
  }

  function mapaMesas() {
    const mesas = banco.todos("select * from mesas where ativo = 1 order by numero");
    const abertos = banco.todos(`select p.*, g.nome as garcom_nome from pedidos p left join usuarios g on g.id = p.garcom_id where p.tipo = 'mesa' and p.status in ${ABERTOS}`);
    return mesas.map((mesa) => {
      const pedido = abertos.find((p) => p.mesa_id === mesa.id);
      if (!pedido) return { ...mesa, situacao: "livre" };
      const prontos = banco.um("select count(*) as n from pedido_itens where pedido_id = ? and status = 'pronto'", pedido.id).n;
      return {
        ...mesa,
        situacao: pedido.status === "conta" ? "conta" : "ocupada",
        pedido: { id: pedido.id, numero: pedido.numero, aberto_em: pedido.aberto_em, garcom_nome: pedido.garcom_nome, pessoas: pedido.pessoas, total: totais(pedido).total, prontos },
      };
    });
  }

  // ---------- Regras ----------

  function proximoNumero() {
    return banco.um("select coalesce(max(numero), 0) + 1 as n from pedidos where aberto_em >= ?", inicioDoDia()).n;
  }

  function exigirAberto(pedido) {
    exigir(pedido, "Pedido não encontrado.", 404);
    exigir(["aberto", "conta"].includes(pedido.status), "Este pedido já foi encerrado.", 409);
  }

  // Monta o item a partir do cardápio (preço sempre do servidor, nunca do aparelho).
  function montarItem(entrada) {
    const quantidade = inteiro(entrada.quantidade || 1);
    exigir(quantidade > 0 && quantidade <= 99, "Quantidade inválida.");
    const ids = (entrada.sabores?.length ? entrada.sabores : [entrada.produto_id]).map(inteiro);
    exigir(ids.length >= 1 && ids.length <= 2, "Escolha no máximo 2 sabores.");
    const produtos = ids.map((id) => banco.um(`select p.*, c.setor_id as setor_categoria, c.meio_a_meio, c.nome as categoria_nome
      from produtos p join categorias c on c.id = p.categoria_id where p.id = ? and p.ativo = 1`, id));
    exigir(produtos.every(Boolean), "Produto não encontrado no cardápio.");
    const esgotado = produtos.find((p) => !p.disponivel);
    exigir(!esgotado, `${esgotado?.nome} está esgotado.`);
    const principal = produtos[0];
    let nome = principal.nome;
    let preco = principal.preco;
    if (produtos.length === 2) {
      exigir(produtos.every((p) => p.meio_a_meio && p.categoria_id === principal.categoria_id), "Só é possível combinar sabores da mesma categoria de pizzas.");
      exigir(produtos[0].tamanho === produtos[1].tamanho, "Os dois sabores precisam ser do mesmo tamanho.");
      preco = Math.max(produtos[0].preco, produtos[1].preco); // cobra o sabor mais caro
      const tamanho = principal.tamanho ? ` ${principal.tamanho}` : "";
      const sabor = (p) => p.nome.replace(/\s+(P|M|G|GG)$/i, "").replace(/^Pizza\s+/i, "");
      nome = `${principal.categoria_nome.replace(/s$/, "")}${tamanho} meio a meio: ${sabor(produtos[0])} / ${sabor(produtos[1])}`;
    }
    return {
      produto_id: principal.id,
      nome,
      sabores: produtos.length === 2 ? JSON.stringify(produtos.map((p) => ({ id: p.id, nome: p.nome }))) : null,
      quantidade,
      preco_unit: preco,
      observacao: String(entrada.observacao || "").trim().slice(0, 200) || null,
      setor_id: principal.setor_id || principal.setor_categoria || null,
    };
  }

  function abrirPedido(dados, sessao) {
    const tipo = dados.tipo;
    exigir(["mesa", "balcao", "delivery"].includes(tipo), "Tipo de pedido inválido.");
    if (tipo === "mesa") {
      const mesa = banco.um("select * from mesas where id = ? and ativo = 1", inteiro(dados.mesa_id));
      exigir(mesa, "Mesa não encontrada.", 404);
      const existente = banco.um(`select id from pedidos where mesa_id = ? and status in ${ABERTOS}`, mesa.id);
      if (existente) return existente.id;
    }
    let clienteId = null;
    let taxaEntrega = 0;
    if (tipo === "delivery") {
      const cliente = dados.cliente || {};
      exigir(String(cliente.nome || "").trim(), "Informe o nome do cliente.");
      exigir(String(cliente.endereco || "").trim(), "Informe o endereço de entrega.");
      const telefone = String(cliente.telefone || "").replace(/\D/g, "") || null;
      const existente = telefone ? banco.um("select id from clientes where telefone = ?", telefone) : null;
      if (existente) {
        clienteId = existente.id;
        banco.exec("update clientes set nome = ?, endereco = ?, numero = ?, bairro = ?, complemento = ?, referencia = ? where id = ?",
          cliente.nome.trim(), cliente.endereco.trim(), cliente.numero || null, cliente.bairro || null, cliente.complemento || null, cliente.referencia || null, clienteId);
      } else {
        clienteId = Number(banco.exec("insert into clientes (nome, telefone, endereco, numero, bairro, complemento, referencia, criado_em) values (?, ?, ?, ?, ?, ?, ?, ?)",
          cliente.nome.trim(), telefone, cliente.endereco.trim(), cliente.numero || null, cliente.bairro || null, cliente.complemento || null, cliente.referencia || null, Date.now()).lastInsertRowid);
      }
      const bairro = cliente.bairro ? banco.um("select taxa from bairros where nome = ? and ativo = 1", cliente.bairro) : null;
      taxaEntrega = Number.isInteger(dados.taxa_entrega) ? dados.taxa_entrega : bairro?.taxa || 0;
    }
    const endereco = tipo === "delivery" ? [dados.cliente.endereco, dados.cliente.numero, dados.cliente.complemento].filter(Boolean).join(", ") : null;
    const r = banco.exec(`insert into pedidos (numero, tipo, mesa_id, cliente_id, cliente_nome, garcom_id, pessoas, taxa_servico_pct, taxa_entrega, observacao,
      entrega_endereco, entrega_bairro, entrega_status, troco_para, aberto_por, aberto_em) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      proximoNumero(), tipo, tipo === "mesa" ? inteiro(dados.mesa_id) : null, clienteId,
      tipo === "delivery" ? dados.cliente.nome.trim() : String(dados.cliente_nome || "").trim() || null,
      sessao.usuario.papel === "garcom" ? sessao.usuario.id : null, inteiro(dados.pessoas) || null,
      tipo === "mesa" ? banco.config("taxa_servico_pct", TAXA_SERVICO_PADRAO) : 0, taxaEntrega, dados.observacao || null,
      endereco, tipo === "delivery" ? dados.cliente.bairro || null : null, tipo === "delivery" ? "recebido" : null,
      Number.isInteger(dados.troco_para) ? dados.troco_para : null, sessao.usuario.id, Date.now());
    return Number(r.lastInsertRowid);
  }

  // Fecha o pedido quando está todo pago: libera a mesa e baixa o estoque.
  function fecharSePago(pedidoId, sessao) {
    const pedido = banco.um("select * from pedidos where id = ?", pedidoId);
    const t = totais(pedido);
    if (t.total > 0 && t.restante === 0 && ["aberto", "conta"].includes(pedido.status)) {
      const caixa = sessaoCaixaAberta();
      banco.exec("update pedidos set status = 'fechado', fechado_em = ?, caixa_sessao_id = ? where id = ?", Date.now(), caixa?.id ?? null, pedido.id);
      baixarEstoque(pedido.id, sessao);
      registrar(banco, sessao, "Pedido fechado", `#${pedido.numero} · ${(t.total / 100).toFixed(2)}`);
      return true;
    }
    return false;
  }

  function baixarEstoque(pedidoId, sessao) {
    const itens = banco.todos("select * from pedido_itens where pedido_id = ? and status != 'cancelado'", pedidoId);
    for (const item of itens) {
      const sabores = item.sabores ? JSON.parse(item.sabores).map((s) => s.id) : [item.produto_id];
      for (const produtoId of sabores) {
        for (const ficha of banco.todos("select * from fichas_tecnicas where produto_id = ?", produtoId)) {
          const quantidade = (ficha.quantidade * item.quantidade) / sabores.length;
          banco.exec("update insumos set estoque = estoque - ? where id = ?", quantidade, ficha.insumo_id);
          banco.exec("insert into estoque_movimentos (insumo_id, tipo, quantidade, pedido_id, usuario_id, criado_em) values (?, 'venda', ?, ?, ?, ?)",
            ficha.insumo_id, -quantidade, pedidoId, sessao?.usuario.id ?? null, Date.now());
        }
      }
    }
  }

  function notificar(pedidoId, cozinha = false) {
    const pedido = banco.um("select id, tipo, mesa_id from pedidos where id = ?", pedidoId);
    avisar("pedido", { id: pedidoId, tipo: pedido?.tipo });
    if (pedido?.tipo === "mesa") avisar("mesas");
    if (cozinha) avisar("cozinha");
  }

  // ---------- Rotas ----------

  function rotas(rota) {
    rota("GET", "/api/mesas", () => mapaMesas());

    rota("GET", "/api/pedidos", ({ query }) => {
      const condicoes = [];
      const valores = [];
      const status = query.get("status");
      if (status === "abertos") condicoes.push(`p.status in ${ABERTOS}`);
      else if (status) { condicoes.push("p.status = ?"); valores.push(status); }
      if (query.get("tipo")) { condicoes.push("p.tipo = ?"); valores.push(query.get("tipo")); }
      if (query.get("hoje") === "1") { condicoes.push("p.aberto_em >= ?"); valores.push(inicioDoDia()); }
      const where = condicoes.length ? `where ${condicoes.join(" and ")}` : "";
      return banco.todos(`select p.*, m.numero as mesa_numero, e.nome as entregador_nome from pedidos p left join mesas m on m.id = p.mesa_id
        left join usuarios e on e.id = p.entregador_id ${where} order by p.id desc limit 300`, ...valores)
        .map((pedido) => ({ ...pedido, totais: totais(pedido) }));
    });

    rota("GET", "/api/pedidos/:id", ({ params }) => pedidoCompleto(inteiro(params.id)));

    rota("POST", "/api/pedidos", { papeis: ["gerente", "caixa", "garcom"] }, ({ corpo, sessao }) => {
      if (corpo.itens?.length) corpo.itens.forEach(montarItem); // confere os itens antes de abrir a conta
      const id = banco.transacao(() => abrirPedido(corpo, sessao));
      if (corpo.itens?.length) adicionar(id, corpo.itens, sessao);
      notificar(id, Boolean(corpo.itens?.length));
      return pedidoCompleto(id);
    });

    function adicionar(pedidoId, itens, sessao) {
      const pedido = banco.um("select * from pedidos where id = ?", pedidoId);
      exigirAberto(pedido);
      exigir(Array.isArray(itens) && itens.length, "Nenhum item informado.");
      const montados = itens.map(montarItem);
      banco.transacao(() => {
        const agora = Date.now();
        for (const item of montados) {
          banco.exec(`insert into pedido_itens (pedido_id, produto_id, nome, sabores, quantidade, preco_unit, observacao, setor_id, status, lancado_por, lancado_em, entregue_em)
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            pedido.id, item.produto_id, item.nome, item.sabores, item.quantidade, item.preco_unit, item.observacao, item.setor_id,
            item.setor_id ? "novo" : "entregue", sessao.usuario.id, agora, item.setor_id ? null : agora);
        }
        if (pedido.status === "conta") banco.exec("update pedidos set status = 'aberto' where id = ?", pedido.id);
        if (!pedido.garcom_id && sessao.usuario.papel === "garcom") banco.exec("update pedidos set garcom_id = ? where id = ?", sessao.usuario.id, pedido.id);
      });
    }

    rota("POST", "/api/pedidos/:id/itens", { papeis: ["gerente", "caixa", "garcom"] }, ({ params, corpo, sessao }) => {
      const id = inteiro(params.id);
      adicionar(id, corpo.itens, sessao);
      notificar(id, true);
      return pedidoCompleto(id);
    });

    rota("POST", "/api/itens/:id/cancelar", { papeis: ["gerente", "caixa", "garcom"] }, ({ params, corpo, sessao }) => {
      const item = banco.um("select * from pedido_itens where id = ?", inteiro(params.id));
      exigir(item && item.status !== "cancelado", "Item não encontrado.", 404);
      exigirAberto(banco.um("select * from pedidos where id = ?", item.pedido_id));
      if (sessao.usuario.papel === "garcom") exigir(item.status === "novo" && item.lancado_por === sessao.usuario.id, "O preparo já começou. Peça ao caixa ou ao gerente para cancelar.", 403);
      else exigir(String(corpo.motivo || "").trim() || item.status === "novo", "Informe o motivo do cancelamento.");
      banco.exec("update pedido_itens set status = 'cancelado', cancelado_motivo = ?, cancelado_por = ? where id = ?", corpo.motivo || "Cancelado antes do preparo", sessao.usuario.id, item.id);
      registrar(banco, sessao, "Item cancelado", `${item.quantidade}x ${item.nome}${corpo.motivo ? ` · ${corpo.motivo}` : ""}`);
      notificar(item.pedido_id, true);
      return pedidoCompleto(item.pedido_id);
    });

    // Cozinha: itens em aberto, agrupados por pedido.
    rota("GET", "/api/cozinha", ({ query, sessao }) => {
      const setor = query.get("setor") || (sessao.usuario.papel === "cozinha" ? sessao.usuario.setor : null);
      const limitePronto = Date.now() - 20 * 60 * 1000;
      const itens = banco.todos(`select i.*, s.nome as setor_nome, p.numero, p.tipo, p.cliente_nome, p.observacao as pedido_obs, m.numero as mesa_numero, u.nome as lancado_por_nome
        from pedido_itens i join pedidos p on p.id = i.pedido_id left join mesas m on m.id = p.mesa_id left join setores s on s.id = i.setor_id left join usuarios u on u.id = i.lancado_por
        where i.setor_id is not null and (i.status in ('novo', 'preparo') or (i.status = 'pronto' and i.pronto_em > ?)) ${setor ? "and i.setor_id = ?" : ""}
        order by i.lancado_em`, limitePronto, ...(setor ? [inteiro(setor)] : []));
      return itens.map((item) => ({ ...item, sabores: item.sabores ? JSON.parse(item.sabores) : null }));
    });

    rota("POST", "/api/itens/:id/status", ({ params, corpo, sessao }) => {
      const item = banco.um("select * from pedido_itens where id = ?", inteiro(params.id));
      exigir(item && item.status !== "cancelado", "Item não encontrado.", 404);
      const fluxo = { novo: ["preparo", "pronto"], preparo: ["pronto", "novo"], pronto: ["entregue", "preparo"], entregue: [] };
      exigir(fluxo[item.status]?.includes(corpo.status), "Mudança de situação inválida.");
      if (corpo.status === "entregue") exigir(["gerente", "caixa", "garcom", "cozinha"].includes(sessao.usuario.papel), "Sem permissão.", 403);
      else exigir(["gerente", "caixa", "cozinha"].includes(sessao.usuario.papel), "Somente a cozinha muda o preparo.", 403);
      const coluna = { preparo: "preparo_em", pronto: "pronto_em", entregue: "entregue_em", novo: null }[corpo.status];
      banco.exec(`update pedido_itens set status = ?${coluna ? `, ${coluna} = ?` : ""} where id = ?`, ...[corpo.status, ...(coluna ? [Date.now()] : []), item.id]);
      const pedido = banco.um("select * from pedidos where id = ?", item.pedido_id);
      if (pedido.tipo === "delivery" && pedido.entrega_status === "recebido" && corpo.status === "preparo") banco.exec("update pedidos set entrega_status = 'preparo' where id = ?", pedido.id);
      notificar(item.pedido_id, true);
      if (corpo.status === "pronto") avisar("pronto", { pedido_id: pedido.id, item: item.nome, mesa_id: pedido.mesa_id, garcom_id: pedido.garcom_id });
    });

    rota("POST", "/api/pedidos/:id/conta", { papeis: ["gerente", "caixa", "garcom"] }, ({ params, sessao }) => {
      const pedido = banco.um("select * from pedidos where id = ?", inteiro(params.id));
      exigirAberto(pedido);
      banco.exec("update pedidos set status = 'conta' where id = ?", pedido.id);
      registrar(banco, sessao, "Conta pedida", `#${pedido.numero}`);
      notificar(pedido.id);
      avisar("conta", { pedido_id: pedido.id, mesa_id: pedido.mesa_id });
      return pedidoCompleto(pedido.id);
    });

    rota("POST", "/api/pedidos/:id/ajustes", { papeis: ["gerente", "caixa"] }, ({ params, corpo, sessao }) => {
      const pedido = banco.um("select * from pedidos where id = ?", inteiro(params.id));
      exigirAberto(pedido);
      const desconto = corpo.desconto === undefined ? pedido.desconto : inteiro(corpo.desconto);
      const servico = corpo.taxa_servico_pct === undefined ? pedido.taxa_servico_pct : inteiro(corpo.taxa_servico_pct);
      const entrega = corpo.taxa_entrega === undefined ? pedido.taxa_entrega : inteiro(corpo.taxa_entrega);
      exigir(desconto >= 0 && servico >= 0 && servico <= 200 && entrega >= 0, "Valores inválidos.");
      if (desconto > 0 && desconto !== pedido.desconto) exigir(String(corpo.motivo || "").trim(), "Informe o motivo do desconto.");
      banco.exec("update pedidos set desconto = ?, taxa_servico_pct = ?, taxa_entrega = ?, pessoas = coalesce(?, pessoas) where id = ?", desconto, servico, entrega, inteiro(corpo.pessoas) || null, pedido.id);
      registrar(banco, sessao, "Ajuste na conta", `#${pedido.numero} · desconto ${desconto} · serviço ${servico / 10}% · entrega ${entrega}${corpo.motivo ? ` · ${corpo.motivo}` : ""}`);
      notificar(pedido.id);
      return pedidoCompleto(pedido.id);
    });

    rota("POST", "/api/pedidos/:id/transferir", { papeis: ["gerente", "caixa", "garcom"] }, ({ params, corpo, sessao }) => {
      const pedido = banco.um("select * from pedidos where id = ?", inteiro(params.id));
      exigirAberto(pedido);
      exigir(pedido.tipo === "mesa", "Só pedidos de mesa podem ser transferidos.");
      const destino = banco.um("select * from mesas where id = ? and ativo = 1", inteiro(corpo.mesa_id));
      exigir(destino, "Mesa de destino não encontrada.", 404);
      const ocupada = banco.um(`select id from pedidos where mesa_id = ? and status in ${ABERTOS}`, destino.id);
      banco.transacao(() => {
        if (ocupada) {
          // Junta as contas: itens e pagamentos vão para a mesa de destino.
          banco.exec("update pedido_itens set pedido_id = ? where pedido_id = ?", ocupada.id, pedido.id);
          banco.exec("update pagamentos set pedido_id = ? where pedido_id = ?", ocupada.id, pedido.id);
          banco.exec("update pedidos set status = 'cancelado', cancelado_motivo = ?, fechado_em = ? where id = ?", `Juntado à mesa ${destino.numero}`, Date.now(), pedido.id);
        } else banco.exec("update pedidos set mesa_id = ? where id = ?", destino.id, pedido.id);
      });
      registrar(banco, sessao, ocupada ? "Mesas juntadas" : "Mesa transferida", `#${pedido.numero} → mesa ${destino.numero}`);
      avisar("mesas");
      avisar("cozinha");
      return pedidoCompleto(ocupada ? ocupada.id : pedido.id);
    });

    rota("POST", "/api/pedidos/:id/cancelar", { papeis: ["gerente", "caixa", "garcom"] }, ({ params, corpo, sessao }) => {
      const pedido = banco.um("select * from pedidos where id = ?", inteiro(params.id));
      exigirAberto(pedido);
      // Garçom e caixa só liberam conta aberta por engano (sem itens); com itens, só o gerente cancela.
      const vazio = !banco.um("select 1 from pedido_itens where pedido_id = ? and status != 'cancelado'", pedido.id);
      exigir(vazio || sessao.usuario.papel === "gerente", "Só o gerente cancela pedidos com itens.", 403);
      if (vazio && !corpo.motivo) corpo.motivo = "Aberto por engano";
      exigir(String(corpo.motivo || "").trim(), "Informe o motivo do cancelamento.");
      exigir(totais(pedido).pago === 0, "Estorne os pagamentos antes de cancelar o pedido.");
      banco.transacao(() => {
        banco.exec("update pedido_itens set status = 'cancelado', cancelado_motivo = ?, cancelado_por = ? where pedido_id = ? and status != 'cancelado'", corpo.motivo, sessao.usuario.id, pedido.id);
        banco.exec("update pedidos set status = 'cancelado', cancelado_motivo = ?, fechado_em = ? where id = ?", corpo.motivo, Date.now(), pedido.id);
      });
      registrar(banco, sessao, "Pedido cancelado", `#${pedido.numero} · ${corpo.motivo}`);
      notificar(pedido.id, true);
    });

    // ---------- Pagamentos ----------
    rota("POST", "/api/pedidos/:id/pagamentos", { papeis: ["gerente", "caixa"] }, ({ params, corpo, sessao }) => {
      const pedido = banco.um("select * from pedidos where id = ?", inteiro(params.id));
      exigirAberto(pedido);
      const caixa = sessaoCaixaAberta();
      exigir(caixa, "Abra o caixa antes de receber pagamentos.", 409);
      exigir(FORMAS.includes(corpo.forma), "Forma de pagamento inválida.");
      const restante = totais(pedido).restante;
      exigir(restante > 0, "Esta conta já está paga.", 409);
      let valor = inteiro(corpo.valor);
      let recebido = null;
      let troco = 0;
      if (corpo.forma === "dinheiro") {
        // Valor aplicado na conta (pode ser só uma parte); o que o cliente entregou a mais vira troco.
        recebido = inteiro(corpo.recebido ?? corpo.valor);
        exigir(recebido > 0, "Informe o valor recebido.");
        const pretendido = corpo.valor === undefined ? recebido : inteiro(corpo.valor);
        exigir(pretendido > 0, "Informe o valor.");
        valor = Math.min(pretendido, recebido, restante);
        troco = recebido - valor;
      } else {
        exigir(valor > 0, "Informe o valor.");
        exigir(valor <= restante, `O valor passa do que falta pagar (${(restante / 100).toFixed(2).replace(".", ",")}).`);
      }
      let fechou = false;
      banco.transacao(() => {
        banco.exec("insert into pagamentos (pedido_id, caixa_sessao_id, forma, valor, recebido, troco, usuario_id, criado_em) values (?, ?, ?, ?, ?, ?, ?, ?)",
          pedido.id, caixa.id, corpo.forma, valor, recebido, troco, sessao.usuario.id, Date.now());
        fechou = fecharSePago(pedido.id, sessao);
      });
      registrar(banco, sessao, "Pagamento", `#${pedido.numero} · ${corpo.forma} ${(valor / 100).toFixed(2)}${troco ? ` · troco ${(troco / 100).toFixed(2)}` : ""}`);
      notificar(pedido.id);
      avisar("caixa");
      return { ...pedidoCompleto(pedido.id), troco, fechou };
    });

    rota("POST", "/api/pagamentos/:id/estornar", { papeis: ["gerente", "caixa"] }, ({ params, corpo, sessao }) => {
      const pagamento = banco.um("select * from pagamentos where id = ? and estornado_em is null", inteiro(params.id));
      exigir(pagamento, "Pagamento não encontrado.", 404);
      const pedido = banco.um("select * from pedidos where id = ?", pagamento.pedido_id);
      exigir(pedido.status !== "fechado" || sessao.usuario.papel === "gerente", "Conta já fechada: só o gerente pode estornar.", 403);
      exigir(String(corpo.motivo || "").trim(), "Informe o motivo do estorno.");
      banco.transacao(() => {
        banco.exec("update pagamentos set estornado_em = ?, estornado_por = ? where id = ?", Date.now(), sessao.usuario.id, pagamento.id);
        if (pedido.status === "fechado") banco.exec("update pedidos set status = 'aberto', fechado_em = null where id = ?", pedido.id);
      });
      registrar(banco, sessao, "Estorno de pagamento", `#${pedido.numero} · ${pagamento.forma} ${(pagamento.valor / 100).toFixed(2)} · ${corpo.motivo}`);
      notificar(pedido.id);
      avisar("caixa");
      return pedidoCompleto(pedido.id);
    });

    // ---------- Delivery ----------
    rota("POST", "/api/pedidos/:id/entrega", { papeis: ["gerente", "caixa", "entregador"] }, ({ params, corpo, sessao }) => {
      const pedido = banco.um("select * from pedidos where id = ?", inteiro(params.id));
      exigir(pedido && pedido.tipo === "delivery", "Pedido de entrega não encontrado.", 404);
      exigir(["recebido", "preparo", "saiu", "entregue"].includes(corpo.status), "Situação inválida.");
      const entregador = corpo.entregador_id ? banco.um("select id from usuarios where id = ? and papel = 'entregador' and ativo = 1", inteiro(corpo.entregador_id)) : null;
      if (corpo.status === "saiu") exigir(entregador || pedido.entregador_id || sessao.usuario.papel === "entregador", "Escolha o entregador.");
      const entregadorId = entregador?.id || pedido.entregador_id || (sessao.usuario.papel === "entregador" ? sessao.usuario.id : null);
      banco.exec("update pedidos set entrega_status = ?, entregador_id = ? where id = ?", corpo.status, entregadorId, pedido.id);
      registrar(banco, sessao, "Entrega", `#${pedido.numero} · ${corpo.status}`);
      notificar(pedido.id);
      return pedidoCompleto(pedido.id);
    });

    rota("GET", "/api/clientes", ({ query }) => {
      const busca = `%${String(query.get("busca") || "").replace(/\D/g, "") || query.get("busca") || ""}%`;
      return banco.todos("select * from clientes where telefone like ? or nome like ? order by nome limit 20", busca, `%${query.get("busca") || ""}%`);
    });
  }

  return { rotas, pedidoCompleto, totais, sessaoCaixaAberta, inicioDoDia };
}

module.exports = { criarPedidos, FORMAS, inicioDoDia };

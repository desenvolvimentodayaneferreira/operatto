// Cardápio (setores de preparo, categorias, produtos), mesas e bairros de entrega.
const { registrar, exigir } = require("./acesso");

const inteiro = (valor) => (Number.isInteger(Number(valor)) ? Number(valor) : NaN);

function criarCardapio(banco, avisar) {
  function cardapioCompleto(incluirInativos = false) {
    const filtro = incluirInativos ? "" : "where ativo = 1";
    return {
      setores: banco.todos("select * from setores order by ordem, nome"),
      categorias: banco.todos(`select * from categorias ${filtro} order by ordem, nome`),
      produtos: banco.todos(`select * from produtos ${filtro} order by ordem, nome`),
    };
  }

  function validarProduto(corpo) {
    exigir(String(corpo.nome || "").trim(), "Informe o nome do produto.");
    exigir(banco.um("select 1 from categorias where id = ?", inteiro(corpo.categoria_id)), "Escolha a categoria.");
    exigir(Number.isInteger(corpo.preco) && corpo.preco >= 0, "Preço inválido.");
  }

  function rotas(rota) {
    rota("GET", "/api/cardapio", ({ query }) => cardapioCompleto(query.get("todos") === "1"));

    // ---------- Setores de preparo (Cozinha, Pizzaria, Bar…) ----------
    rota("POST", "/api/setores", { papeis: ["gerente"] }, ({ corpo, sessao }) => {
      exigir(String(corpo.nome || "").trim(), "Informe o nome do setor.");
      const r = banco.exec("insert into setores (nome, ordem) values (?, ?)", corpo.nome.trim(), inteiro(corpo.ordem) || 0);
      registrar(banco, sessao, "Cadastro de setor", corpo.nome.trim());
      return { id: Number(r.lastInsertRowid) };
    });

    // ---------- Categorias ----------
    rota("POST", "/api/categorias", { papeis: ["gerente"] }, ({ corpo, sessao }) => {
      exigir(String(corpo.nome || "").trim(), "Informe o nome da categoria.");
      const r = banco.exec("insert into categorias (nome, ordem, setor_id, meio_a_meio) values (?, ?, ?, ?)",
        corpo.nome.trim(), inteiro(corpo.ordem) || 0, corpo.setor_id || null, corpo.meio_a_meio ? 1 : 0);
      registrar(banco, sessao, "Cadastro de categoria", corpo.nome.trim());
      avisar("cardapio");
      return { id: Number(r.lastInsertRowid) };
    });

    rota("PUT", "/api/categorias/:id", { papeis: ["gerente"] }, ({ params, corpo, sessao }) => {
      const atual = banco.um("select * from categorias where id = ?", inteiro(params.id));
      exigir(atual, "Categoria não encontrada.", 404);
      const novo = { ...atual, ...corpo };
      banco.exec("update categorias set nome = ?, ordem = ?, setor_id = ?, meio_a_meio = ?, ativo = ? where id = ?",
        String(novo.nome).trim(), inteiro(novo.ordem) || 0, novo.setor_id || null, novo.meio_a_meio ? 1 : 0, novo.ativo ? 1 : 0, atual.id);
      registrar(banco, sessao, "Alteração de categoria", novo.nome);
      avisar("cardapio");
    });

    // ---------- Produtos ----------
    rota("POST", "/api/produtos", { papeis: ["gerente"] }, ({ corpo, sessao }) => {
      validarProduto(corpo);
      const r = banco.exec(`insert into produtos (categoria_id, nome, descricao, tamanho, preco, setor_id, codigo, ordem, ncm, cfop, cest, csosn, origem, unidade)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        inteiro(corpo.categoria_id), corpo.nome.trim(), corpo.descricao || null, corpo.tamanho || null, corpo.preco, corpo.setor_id || null,
        corpo.codigo || null, inteiro(corpo.ordem) || 0, corpo.ncm || null, corpo.cfop || null, corpo.cest || null, corpo.csosn || null, inteiro(corpo.origem) || 0, corpo.unidade || "UN");
      registrar(banco, sessao, "Cadastro de produto", corpo.nome.trim());
      avisar("cardapio");
      return { id: Number(r.lastInsertRowid) };
    });

    rota("PUT", "/api/produtos/:id", { papeis: ["gerente"] }, ({ params, corpo, sessao }) => {
      const atual = banco.um("select * from produtos where id = ?", inteiro(params.id));
      exigir(atual, "Produto não encontrado.", 404);
      const novo = { ...atual, ...corpo };
      validarProduto(novo);
      banco.exec(`update produtos set categoria_id = ?, nome = ?, descricao = ?, tamanho = ?, preco = ?, setor_id = ?, codigo = ?, ordem = ?, ativo = ?, disponivel = ?,
        ncm = ?, cfop = ?, cest = ?, csosn = ?, origem = ?, unidade = ? where id = ?`,
        inteiro(novo.categoria_id), String(novo.nome).trim(), novo.descricao || null, novo.tamanho || null, novo.preco, novo.setor_id || null, novo.codigo || null,
        inteiro(novo.ordem) || 0, novo.ativo ? 1 : 0, novo.disponivel ? 1 : 0, novo.ncm || null, novo.cfop || null, novo.cest || null, novo.csosn || null, inteiro(novo.origem) || 0, novo.unidade || "UN", atual.id);
      const mudouPreco = atual.preco !== novo.preco ? ` · preço ${atual.preco} → ${novo.preco}` : "";
      registrar(banco, sessao, "Alteração de produto", `${novo.nome}${mudouPreco}`);
      avisar("cardapio");
    });

    // Marcar como esgotado/disponível (caixa e gerente, durante o turno).
    rota("POST", "/api/produtos/:id/disponivel", { papeis: ["gerente", "caixa", "cozinha"] }, ({ params, corpo, sessao }) => {
      const produto = banco.um("select * from produtos where id = ?", inteiro(params.id));
      exigir(produto, "Produto não encontrado.", 404);
      banco.exec("update produtos set disponivel = ? where id = ?", corpo.disponivel ? 1 : 0, produto.id);
      registrar(banco, sessao, corpo.disponivel ? "Produto disponível" : "Produto esgotado", produto.nome);
      avisar("cardapio");
    });

    // ---------- Mesas ----------
    rota("POST", "/api/mesas", { papeis: ["gerente"] }, ({ corpo, sessao }) => {
      const numero = inteiro(corpo.numero);
      exigir(numero > 0, "Número da mesa inválido.");
      exigir(!banco.um("select 1 from mesas where numero = ?", numero), `Já existe a mesa ${numero}.`);
      const r = banco.exec("insert into mesas (numero, nome, lugares) values (?, ?, ?)", numero, corpo.nome || null, inteiro(corpo.lugares) || 4);
      registrar(banco, sessao, "Cadastro de mesa", `Mesa ${numero}`);
      avisar("mesas");
      return { id: Number(r.lastInsertRowid) };
    });

    rota("PUT", "/api/mesas/:id", { papeis: ["gerente"] }, ({ params, corpo, sessao }) => {
      const mesa = banco.um("select * from mesas where id = ?", inteiro(params.id));
      exigir(mesa, "Mesa não encontrada.", 404);
      if (corpo.ativo === false) exigir(!banco.um("select 1 from pedidos where mesa_id = ? and status in ('aberto', 'conta')", mesa.id), "A mesa tem conta aberta.");
      banco.exec("update mesas set nome = ?, lugares = ?, ativo = ? where id = ?", corpo.nome ?? mesa.nome, inteiro(corpo.lugares) || mesa.lugares, corpo.ativo === undefined ? mesa.ativo : corpo.ativo ? 1 : 0, mesa.id);
      registrar(banco, sessao, "Alteração de mesa", `Mesa ${mesa.numero}`);
      avisar("mesas");
    });

    // ---------- Bairros e taxas de entrega ----------
    rota("GET", "/api/bairros", () => banco.todos("select * from bairros where ativo = 1 order by nome"));

    rota("POST", "/api/bairros", { papeis: ["gerente"] }, ({ corpo, sessao }) => {
      exigir(String(corpo.nome || "").trim(), "Informe o bairro.");
      exigir(Number.isInteger(corpo.taxa) && corpo.taxa >= 0, "Taxa inválida.");
      banco.exec("insert into bairros (nome, taxa) values (?, ?) on conflict (nome) do update set taxa = excluded.taxa, ativo = 1", corpo.nome.trim(), corpo.taxa);
      registrar(banco, sessao, "Taxa de entrega", `${corpo.nome.trim()}: ${corpo.taxa}`);
    });
  }

  return { rotas, cardapioCompleto };
}

module.exports = { criarCardapio };

// Banco de dados do Operatto (SQLite embutido no Node; um único arquivo no computador do caixa).
// Valores em dinheiro são guardados em centavos (inteiros) para evitar erros de arredondamento.
const { DatabaseSync } = require("node:sqlite");

const MIGRACOES = [
  // 1 — estrutura inicial
  `
  create table config (chave text primary key, valor text not null);

  create table usuarios (
    id integer primary key,
    nome text not null,
    papel text not null check (papel in ('gerente', 'caixa', 'garcom', 'cozinha', 'entregador')),
    setor text,                                  -- cozinha: setor que a tela mostra (null = todos)
    pin_hash text not null,
    pin_sal text not null,
    ativo integer not null default 1,
    tentativas integer not null default 0,
    bloqueado_ate integer,
    criado_em integer not null
  );

  create table sessoes (
    token_hash text primary key,
    usuario_id integer not null references usuarios(id),
    dispositivo text,
    criado_em integer not null,
    ultimo_uso integer not null
  );

  create table setores (id integer primary key, nome text not null unique, ordem integer not null default 0);

  create table categorias (
    id integer primary key,
    nome text not null,
    ordem integer not null default 0,
    setor_id integer references setores(id),
    meio_a_meio integer not null default 0,      -- permite combinar 2 sabores (pizzas)
    ativo integer not null default 1
  );

  create table produtos (
    id integer primary key,
    categoria_id integer not null references categorias(id),
    nome text not null,
    descricao text,
    tamanho text,                                -- ex.: P, M, G (sabores só combinam no mesmo tamanho)
    preco integer not null check (preco >= 0),
    setor_id integer references setores(id),     -- sobrepõe o setor da categoria
    codigo text,
    ativo integer not null default 1,
    disponivel integer not null default 1,       -- 0 = esgotado hoje
    ordem integer not null default 0,
    -- dados fiscais (NFC-e)
    ncm text, cfop text, cest text, csosn text, origem integer default 0, unidade text default 'UN'
  );

  create table mesas (
    id integer primary key,
    numero integer not null unique,
    nome text,
    lugares integer default 4,
    ativo integer not null default 1
  );

  create table clientes (
    id integer primary key,
    nome text not null,
    telefone text,
    endereco text,
    numero text,
    bairro text,
    complemento text,
    referencia text,
    cpf text,
    criado_em integer not null
  );
  create index clientes_telefone on clientes (telefone);

  create table bairros (id integer primary key, nome text not null unique, taxa integer not null default 0, ativo integer not null default 1);

  create table caixa_sessoes (
    id integer primary key,
    aberto_por integer not null references usuarios(id),
    aberto_em integer not null,
    valor_inicial integer not null default 0,
    fechado_por integer references usuarios(id),
    fechado_em integer,
    valor_contado integer,
    observacao text
  );

  create table pedidos (
    id integer primary key,
    numero integer not null,                     -- número do dia
    tipo text not null check (tipo in ('mesa', 'balcao', 'delivery')),
    status text not null default 'aberto' check (status in ('aberto', 'conta', 'fechado', 'cancelado')),
    mesa_id integer references mesas(id),
    cliente_id integer references clientes(id),
    cliente_nome text,
    garcom_id integer references usuarios(id),
    pessoas integer,
    taxa_servico_pct integer not null default 0, -- em décimos de %, ex.: 100 = 10,0%
    desconto integer not null default 0,
    taxa_entrega integer not null default 0,
    observacao text,
    entrega_endereco text,
    entrega_bairro text,
    entrega_status text check (entrega_status in ('recebido', 'preparo', 'saiu', 'entregue')),
    entregador_id integer references usuarios(id),
    troco_para integer,
    caixa_sessao_id integer references caixa_sessoes(id),
    aberto_por integer references usuarios(id),
    aberto_em integer not null,
    fechado_em integer,
    cancelado_motivo text
  );
  create index pedidos_status on pedidos (status);
  create index pedidos_mesa on pedidos (mesa_id, status);

  create table pedido_itens (
    id integer primary key,
    pedido_id integer not null references pedidos(id),
    produto_id integer references produtos(id),
    nome text not null,
    sabores text,                                -- JSON com os produtos combinados (meio a meio)
    quantidade integer not null check (quantidade > 0),
    preco_unit integer not null,
    observacao text,
    setor_id integer references setores(id),
    status text not null default 'novo' check (status in ('novo', 'preparo', 'pronto', 'entregue', 'cancelado')),
    lancado_por integer references usuarios(id),
    lancado_em integer not null,
    preparo_em integer,
    pronto_em integer,
    entregue_em integer,
    cancelado_motivo text,
    cancelado_por integer references usuarios(id)
  );
  create index itens_pedido on pedido_itens (pedido_id);
  create index itens_status on pedido_itens (status);

  create table pagamentos (
    id integer primary key,
    pedido_id integer not null references pedidos(id),
    caixa_sessao_id integer references caixa_sessoes(id),
    forma text not null check (forma in ('dinheiro', 'pix', 'debito', 'credito', 'vale')),
    valor integer not null check (valor > 0),
    recebido integer,                            -- dinheiro entregue pelo cliente
    troco integer not null default 0,
    usuario_id integer references usuarios(id),
    criado_em integer not null,
    estornado_em integer,
    estornado_por integer references usuarios(id)
  );
  create index pagamentos_pedido on pagamentos (pedido_id);

  create table caixa_movimentos (
    id integer primary key,
    sessao_id integer not null references caixa_sessoes(id),
    tipo text not null check (tipo in ('sangria', 'suprimento')),
    valor integer not null check (valor > 0),
    motivo text,
    usuario_id integer references usuarios(id),
    criado_em integer not null
  );

  create table insumos (
    id integer primary key,
    nome text not null,
    unidade text not null default 'un',
    estoque real not null default 0,
    estoque_minimo real not null default 0,
    custo integer not null default 0,            -- custo por unidade, em centavos
    ativo integer not null default 1
  );

  create table fichas_tecnicas (
    produto_id integer not null references produtos(id),
    insumo_id integer not null references insumos(id),
    quantidade real not null,
    primary key (produto_id, insumo_id)
  );

  create table estoque_movimentos (
    id integer primary key,
    insumo_id integer not null references insumos(id),
    tipo text not null check (tipo in ('entrada', 'saida', 'ajuste', 'venda', 'perda')),
    quantidade real not null,
    custo integer,
    motivo text,
    pedido_id integer references pedidos(id),
    usuario_id integer references usuarios(id),
    criado_em integer not null
  );

  create table contas (
    id integer primary key,
    tipo text not null check (tipo in ('pagar', 'receber')),
    descricao text not null,
    categoria text,
    fornecedor text,
    valor integer not null,
    vencimento text not null,
    pago_em text,
    forma text,
    observacao text,
    criado_em integer not null
  );

  create table nfce (
    id integer primary key,
    pedido_id integer not null references pedidos(id),
    ambiente text not null,
    status text not null,
    numero integer,
    serie integer,
    chave text,
    protocolo text,
    mensagem text,
    referencia text,
    criado_em integer not null,
    atualizado_em integer
  );

  create table auditoria (
    id integer primary key,
    usuario_id integer,
    usuario_nome text,
    acao text not null,
    detalhe text,
    criado_em integer not null
  );
  `,
];

function abrir(arquivo) {
  const db = new DatabaseSync(arquivo);
  db.exec("pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;");
  const versao = db.prepare("pragma user_version").get().user_version;
  for (let i = versao; i < MIGRACOES.length; i++) {
    db.exec("begin");
    try {
      db.exec(MIGRACOES[i]);
      db.exec(`pragma user_version = ${i + 1}`);
      db.exec("commit");
    } catch (erro) {
      db.exec("rollback");
      throw erro;
    }
  }

  const banco = {
    bruto: db,
    todos: (sql, ...p) => db.prepare(sql).all(...p),
    um: (sql, ...p) => db.prepare(sql).get(...p) || null,
    exec: (sql, ...p) => db.prepare(sql).run(...p),
    // Executa várias gravações de uma vez: ou grava tudo, ou nada.
    transacao(fn) {
      db.exec("begin immediate");
      try {
        const resultado = fn();
        db.exec("commit");
        return resultado;
      } catch (erro) {
        db.exec("rollback");
        throw erro;
      }
    },
    config(chave, padrao = null) {
      const linha = db.prepare("select valor from config where chave = ?").get(chave);
      return linha ? JSON.parse(linha.valor) : padrao;
    },
    salvarConfig(chave, valor) {
      db.prepare("insert into config (chave, valor) values (?, ?) on conflict (chave) do update set valor = excluded.valor").run(chave, JSON.stringify(valor));
    },
    // Cópia de segurança consistente mesmo com o sistema em uso.
    copiar(destino) {
      db.prepare("vacuum into ?").run(destino);
    },
    fechar: () => db.close(),
  };
  return banco;
}

module.exports = { abrir };

// Testes das regras do Operatto pela API (servidor real, banco temporário).
// Rodar: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { iniciarServidor } = require("../servidor/app");

let app;
let base;
const tokens = {};
const ids = {};

async function api(metodo, caminho, corpo, quem) {
  const resposta = await fetch(base + caminho, {
    method: metodo,
    headers: { "Content-Type": "application/json", ...(quem ? { Authorization: `Bearer ${tokens[quem]}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await resposta.json();
  return { status: resposta.status, dados };
}
const ok = async (...args) => {
  const r = await api(...args);
  assert.equal(r.status, 200, `${args[0]} ${args[1]} → ${r.status}: ${JSON.stringify(r.dados)}`);
  return r.dados;
};

test.before(async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "operatto-teste-"));
  app = iniciarServidor({ pastaDados: pasta, porta: 0, host: "127.0.0.1", descoberta: false });
  base = `http://127.0.0.1:${await app.pronto}`;
});
test.after(() => app.parar());

test("configuração inicial e login por PIN", async () => {
  assert.equal((await ok("GET", "/api/estado")).configurado, false);
  assert.equal((await api("POST", "/api/configurar", { restaurante: "Restaurante Exemplo", nome: "Dayane", pin: "12" })).status, 400);
  await ok("POST", "/api/configurar", { restaurante: "Restaurante Exemplo", nome: "Dayane", pin: "1234" });
  assert.equal((await api("POST", "/api/configurar", { restaurante: "X", nome: "Y", pin: "9999" })).status, 409);
  const equipe = await ok("GET", "/api/equipe-login");
  ids.gerente = equipe[0].id;
  assert.equal((await api("POST", "/api/login", { usuario_id: ids.gerente, pin: "0000" })).status, 401);
  tokens.gerente = (await ok("POST", "/api/login", { usuario_id: ids.gerente, pin: "1234", dispositivo: "teste" })).token;
  assert.equal((await api("GET", "/api/eu")).status, 401, "sem token não entra");
});

test("cadastro da equipe e permissões", async () => {
  for (const [papel, nome, pin] of [["garcom", "Carlos", "1111"], ["caixa", "Ana", "2222"], ["cozinha", "Chef", "3333"], ["entregador", "Beto", "4444"]]) {
    ids[papel] = (await ok("POST", "/api/usuarios", { nome, papel, pin }, "gerente")).id;
    tokens[papel] = (await ok("POST", "/api/login", { usuario_id: ids[papel], pin })).token;
  }
  assert.equal((await api("POST", "/api/usuarios", { nome: "X", papel: "garcom", pin: "5555" }, "garcom")).status, 403, "garçom não cadastra equipe");
});

test("bloqueio após 5 PINs errados", async () => {
  const id = (await ok("POST", "/api/usuarios", { nome: "Temp", papel: "garcom", pin: "7777" }, "gerente")).id;
  for (let i = 0; i < 5; i++) await api("POST", "/api/login", { usuario_id: id, pin: "0000" });
  const r = await api("POST", "/api/login", { usuario_id: id, pin: "7777" });
  assert.equal(r.status, 423, "bloqueado mesmo com o PIN certo");
  await ok("PUT", `/api/usuarios/${id}`, { desbloquear: true }, "gerente");
  await ok("POST", "/api/login", { usuario_id: id, pin: "7777" });
});

test("cardápio de exemplo e mesas", async () => {
  const cardapio = await ok("GET", "/api/cardapio", null, "garcom");
  assert.ok(cardapio.produtos.length > 20);
  const nome = (n) => cardapio.produtos.find((p) => p.nome === n);
  ids.calabresaG = nome("Pizza Calabresa G").id;
  ids.especialG = nome("Pizza Especial da Casa G").id;
  ids.calabresaM = nome("Pizza Calabresa M").id;
  ids.picanha = nome("Picanha na Chapa").id;
  ids.coca = nome("Coca-Cola 2 L").id;
  const mesas = await ok("GET", "/api/mesas", null, "garcom");
  assert.equal(mesas.length, 32);
  ids.mesa5 = mesas.find((m) => m.numero === 5).id;
  ids.mesa6 = mesas.find((m) => m.numero === 6).id;
});

test("garçom lança pedido na mesa com pizza meio a meio", async () => {
  const pedido = await ok("POST", "/api/pedidos", {
    tipo: "mesa", mesa_id: ids.mesa5, pessoas: 4,
    itens: [
      { sabores: [ids.calabresaG, ids.especialG], observacao: "sem cebola" },
      { produto_id: ids.picanha, quantidade: 1 },
      { produto_id: ids.coca, quantidade: 2 },
    ],
  }, "garcom");
  ids.pedido = pedido.id;
  const meia = pedido.itens[0];
  assert.equal(meia.preco_unit, 7900, "meio a meio cobra o sabor mais caro");
  assert.match(meia.nome, /meio a meio: Calabresa \/ Especial da Casa/);
  assert.equal(meia.status, "novo");
  assert.equal(pedido.itens[2].status, "entregue", "bebida sem preparo já sai entregue");
  // 79,00 + 89,90 + 2 × 14,00 = 196,90; serviço 10% = 19,69
  assert.equal(pedido.totais.subtotal, 19690);
  assert.equal(pedido.totais.servico, 1969);
  assert.equal(pedido.totais.total, 21659);
  const mesas = await ok("GET", "/api/mesas", null, "garcom");
  assert.equal(mesas.find((m) => m.id === ids.mesa5).situacao, "ocupada");
  // Abrir de novo a mesma mesa devolve a mesma conta.
  assert.equal((await ok("POST", "/api/pedidos", { tipo: "mesa", mesa_id: ids.mesa5 }, "garcom")).id, ids.pedido);
});

test("regras do meio a meio e do esgotado", async () => {
  const r = await api("POST", `/api/pedidos/${ids.pedido}/itens`, { itens: [{ sabores: [ids.calabresaG, ids.calabresaM] }] }, "garcom");
  assert.equal(r.status, 400, "tamanhos diferentes não combinam");
  await ok("POST", `/api/produtos/${ids.picanha}/disponivel`, { disponivel: false }, "caixa");
  assert.equal((await api("POST", `/api/pedidos/${ids.pedido}/itens`, { itens: [{ produto_id: ids.picanha }] }, "garcom")).status, 400, "esgotado não pode ser pedido");
  await ok("POST", `/api/produtos/${ids.picanha}/disponivel`, { disponivel: true }, "caixa");
  assert.equal((await api("POST", "/api/pedidos", { tipo: "mesa", mesa_id: ids.mesa6, itens: [{ produto_id: 999999 }] }, "garcom")).status, 400);
  const mesas = await ok("GET", "/api/mesas", null, "garcom");
  assert.equal(mesas.find((m) => m.id === ids.mesa6).situacao, "livre", "item inválido não deixa mesa aberta");
});

test("cozinha prepara e garçom entrega", async () => {
  const fila = await ok("GET", "/api/cozinha", null, "cozinha");
  const itens = fila.filter((i) => i.pedido_id === ids.pedido);
  assert.equal(itens.length, 2, "bebida não vai para a cozinha");
  assert.equal((await api("POST", `/api/itens/${itens[0].id}/status`, { status: "preparo" }, "garcom")).status, 403, "garçom não muda preparo");
  for (const item of itens) {
    await ok("POST", `/api/itens/${item.id}/status`, { status: "preparo" }, "cozinha");
    await ok("POST", `/api/itens/${item.id}/status`, { status: "pronto" }, "cozinha");
  }
  assert.equal((await ok("GET", "/api/mesas", null, "garcom")).find((m) => m.id === ids.mesa5).pedido.prontos, 2);
  await ok("POST", `/api/itens/${itens[0].id}/status`, { status: "entregue" }, "garcom");
  const cancel = await api("POST", `/api/itens/${itens[1].id}/cancelar`, {}, "garcom");
  assert.equal(cancel.status, 403, "garçom não cancela item já preparado");
});

test("pagamento exige caixa aberto e calcula troco", async () => {
  assert.equal((await api("POST", `/api/pedidos/${ids.pedido}/pagamentos`, { forma: "pix", valor: 1000 }, "garcom")).status, 403);
  assert.equal((await api("POST", `/api/pedidos/${ids.pedido}/pagamentos`, { forma: "pix", valor: 1000 }, "caixa")).status, 409, "caixa fechado");
  await ok("POST", "/api/caixa/abrir", { valor_inicial: 20000 }, "caixa");
  await ok("POST", `/api/pedidos/${ids.pedido}/conta`, {}, "garcom");
  let pedido = await ok("POST", `/api/pedidos/${ids.pedido}/pagamentos`, { forma: "pix", valor: 10000 }, "caixa");
  assert.equal(pedido.totais.restante, 11659);
  assert.equal((await api("POST", `/api/pedidos/${ids.pedido}/pagamentos`, { forma: "credito", valor: 50000 }, "caixa")).status, 400, "cartão não passa do restante");
  pedido = await ok("POST", `/api/pedidos/${ids.pedido}/pagamentos`, { forma: "dinheiro", recebido: 15000 }, "caixa");
  assert.equal(pedido.troco, 3341);
  assert.equal(pedido.fechou, true);
  assert.equal(pedido.status, "fechado");
  assert.equal((await ok("GET", "/api/mesas", null, "garcom")).find((m) => m.id === ids.mesa5).situacao, "livre");
});

test("desconto exige motivo; transferência junta contas", async () => {
  const a = await ok("POST", "/api/pedidos", { tipo: "mesa", mesa_id: ids.mesa5, itens: [{ produto_id: ids.coca }] }, "garcom");
  const b = await ok("POST", "/api/pedidos", { tipo: "mesa", mesa_id: ids.mesa6, itens: [{ produto_id: ids.coca, quantidade: 2 }] }, "garcom");
  assert.equal((await api("POST", `/api/pedidos/${a.id}/ajustes`, { desconto: 500 }, "caixa")).status, 400);
  await ok("POST", `/api/pedidos/${a.id}/ajustes`, { desconto: 500, motivo: "Cortesia" }, "caixa");
  const juntado = await ok("POST", `/api/pedidos/${a.id}/transferir`, { mesa_id: ids.mesa6 }, "garcom");
  assert.equal(juntado.id, b.id);
  assert.equal(juntado.itens.length, 2);
  assert.equal((await ok("GET", "/api/mesas", null, "garcom")).find((m) => m.id === ids.mesa5).situacao, "livre");
  ids.pedidoB = b.id;
});

test("delivery com taxa do bairro e entregador", async () => {
  await ok("POST", "/api/bairros", { nome: "Centro", taxa: 500 }, "gerente");
  const pedido = await ok("POST", "/api/pedidos", {
    tipo: "delivery", troco_para: 10000,
    cliente: { nome: "Maria", telefone: "(81) 99999-0000", endereco: "Rua A", numero: "10", bairro: "Centro" },
    itens: [{ produto_id: ids.calabresaM }],
  }, "caixa");
  assert.equal(pedido.taxa_entrega, 500);
  assert.equal(pedido.totais.servico, 0, "delivery sem taxa de serviço");
  assert.equal(pedido.totais.total, 5700);
  assert.equal((await api("POST", `/api/pedidos/${pedido.id}/entrega`, { status: "saiu" }, "caixa")).status, 400, "precisa do entregador");
  const saiu = await ok("POST", `/api/pedidos/${pedido.id}/entrega`, { status: "saiu", entregador_id: ids.entregador }, "caixa");
  assert.equal(saiu.entregador_nome, "Beto");
  const clientes = await ok("GET", "/api/clientes?busca=99999", null, "caixa");
  assert.equal(clientes[0].nome, "Maria");
  await ok("POST", `/api/pedidos/${pedido.id}/pagamentos`, { forma: "dinheiro", recebido: 10000 }, "caixa");
});

test("baixa automática do estoque pela ficha técnica", async () => {
  const banco = app.banco;
  const insumo = Number(banco.exec("insert into insumos (nome, unidade, estoque) values ('Mussarela', 'kg', 10)").lastInsertRowid);
  banco.exec("insert into fichas_tecnicas (produto_id, insumo_id, quantidade) values (?, ?, 0.3)", ids.calabresaG, insumo);
  banco.exec("insert into fichas_tecnicas (produto_id, insumo_id, quantidade) values (?, ?, 0.4)", ids.especialG, insumo);
  const p = await ok("POST", "/api/pedidos", { tipo: "balcao", itens: [{ sabores: [ids.calabresaG, ids.especialG], quantidade: 2 }] }, "caixa");
  await ok("POST", `/api/pedidos/${p.id}/pagamentos`, { forma: "debito", valor: p.totais.total }, "caixa");
  const estoque = banco.um("select estoque from insumos where id = ?", insumo).estoque;
  assert.ok(Math.abs(estoque - (10 - 2 * (0.15 + 0.2))) < 1e-9, `estoque ${estoque}`);
});

test("fechamento do caixa com conferência", async () => {
  await ok("POST", "/api/caixa/movimento", { tipo: "sangria", valor: 5000, motivo: "Depósito" }, "caixa");
  const caixa = (await ok("GET", "/api/caixa", null, "caixa")).aberta;
  // inicial 200 + dinheiro (116,59 + 57,00) − sangria 50 = 323,59
  assert.equal(caixa.porForma.dinheiro, 11659 + 5700);
  assert.equal(caixa.dinheiroEsperado, 20000 + 11659 + 5700 - 5000);
  const pendente = await api("POST", "/api/caixa/fechar", { valor_contado: 32000 }, "caixa");
  assert.equal(pendente.status, 409, "avisa que há conta aberta (mesa 6)");
  const fechado = await ok("POST", "/api/caixa/fechar", { valor_contado: 32000, confirmar_pendentes: true }, "caixa");
  assert.equal(fechado.diferenca, 32000 - (20000 + 11659 + 5700 - 5000));
  const resumo = await ok("GET", "/api/resumo-dia", null, "gerente");
  assert.equal(resumo.pedidos, 3);
});

test("auditoria registra as ações", async () => {
  const eventos = await ok("GET", "/api/auditoria", null, "gerente");
  const acoes = new Set(eventos.map((e) => e.acao));
  for (const acao of ["Configuração inicial", "Pagamento", "Pedido fechado", "Sangria", "Fechamento de caixa", "Ajuste na conta", "Mesas juntadas"]) assert.ok(acoes.has(acao), `faltou: ${acao}`);
});

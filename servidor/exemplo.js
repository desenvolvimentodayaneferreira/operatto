// Cardápio e mesas de exemplo, usados até o restaurante cadastrar o cardápio real.
// Os preços são apenas ilustrativos e ficam marcados como exemplo na tela do gerente.
function prepararExemplo(banco) {
  if (banco.um("select 1 from setores limit 1")) return false;
  const reais = (valor) => Math.round(valor * 100);
  banco.transacao(() => {
    const setor = (nome, ordem) => Number(banco.exec("insert into setores (nome, ordem) values (?, ?)", nome, ordem).lastInsertRowid);
    const pizzaria = setor("Pizzaria", 1);
    const cozinha = setor("Cozinha", 2);
    const bar = setor("Bar", 3);

    const categoria = (nome, ordem, setorId, meio = 0) =>
      Number(banco.exec("insert into categorias (nome, ordem, setor_id, meio_a_meio) values (?, ?, ?, ?)", nome, ordem, setorId, meio).lastInsertRowid);
    const produto = (categoriaId, nome, preco, extra = {}) =>
      banco.exec("insert into produtos (categoria_id, nome, preco, tamanho, descricao, ordem) values (?, ?, ?, ?, ?, ?)",
        categoriaId, nome, reais(preco), extra.tamanho || null, extra.descricao || null, extra.ordem || 0);

    const pizzas = categoria("Pizzas", 1, pizzaria, 1);
    const sabores = [
      ["Calabresa", 52, 62, "Calabresa, cebola e azeitona"],
      ["Portuguesa", 56, 68, "Presunto, ovo, cebola, ervilha e mussarela"],
      ["Frango com Catupiry", 58, 70, "Frango desfiado e catupiry"],
      ["Mussarela", 48, 58, "Mussarela e orégano"],
      ["Quatro Queijos", 62, 74, "Mussarela, provolone, parmesão e catupiry"],
      ["Especial da Casa", 66, 79, "Picanha em tiras, cebola roxa e cheddar"],
    ];
    sabores.forEach(([nome, m, g, descricao], i) => {
      produto(pizzas, `Pizza ${nome} M`, m, { tamanho: "M", descricao, ordem: i * 2 });
      produto(pizzas, `Pizza ${nome} G`, g, { tamanho: "G", descricao, ordem: i * 2 + 1 });
    });

    const grelhados = categoria("Churrasco e grelhados", 2, cozinha);
    produto(grelhados, "Picanha na Chapa", 89.9, { descricao: "500 g, com arroz, farofa e vinagrete" });
    produto(grelhados, "Maminha na Brasa", 74.9, { descricao: "500 g, com arroz, feijão tropeiro e vinagrete" });
    produto(grelhados, "Frango Grelhado", 46.9, { descricao: "Com arroz, salada e fritas" });
    produto(grelhados, "Combo Família", 149.9, { descricao: "Picanha, linguiça, frango, arroz, feijão tropeiro e fritas" });

    const massas = categoria("Massas", 3, cozinha);
    produto(massas, "Lasanha à Bolonhesa", 42.9);
    produto(massas, "Espaguete ao Alho e Óleo", 32.9);

    const porcoes = categoria("Porções", 4, cozinha);
    produto(porcoes, "Batata Frita", 28.9);
    produto(porcoes, "Calabresa Acebolada", 34.9);
    produto(porcoes, "Isca de Peixe", 46.9);

    const bebidas = categoria("Bebidas", 5, null); // servidas direto pelo garçom, sem preparo
    produto(bebidas, "Coca-Cola 2 L", 14);
    produto(bebidas, "Coca-Cola lata", 6.5);
    produto(bebidas, "Guaraná lata", 6);
    produto(bebidas, "Água mineral", 4);
    produto(bebidas, "Cerveja long neck", 9.9);

    const drinks = categoria("Sucos e drinks", 6, bar);
    produto(drinks, "Suco de laranja", 9);
    produto(drinks, "Suco de maracujá", 9);
    produto(drinks, "Caipirinha", 18);

    for (let numero = 1; numero <= 32; numero++) banco.exec("insert into mesas (numero, lugares) values (?, ?)", numero, numero > 28 ? 8 : 4);
    banco.salvarConfig("cardapio_exemplo", true);
  });
  return true;
}

module.exports = { prepararExemplo };

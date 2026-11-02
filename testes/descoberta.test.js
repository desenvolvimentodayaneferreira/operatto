// Teste da descoberta automática: um computador encontra o caixa principal na rede local.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { iniciarServidor } = require("../servidor/app");
const { procurarServidores } = require("../servidor/descoberta");

test("outro computador encontra o caixa principal pela rede", async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), "operatto-descoberta-"));
  const app = iniciarServidor({ pastaDados: pasta, porta: 0 });
  const porta = await app.pronto;
  app.banco.salvarConfig("restaurante", { nome: "Restaurante Teste" });
  try {
    const encontrados = await procurarServidores(1500);
    const este = encontrados.find((s) => s.porta === porta);
    assert.ok(este, `não encontrou o servidor na porta ${porta}: ${JSON.stringify(encontrados)}`);
    assert.equal(este.nome, "Restaurante Teste");
    const estado = await (await fetch(`${este.endereco}/api/estado`)).json();
    assert.equal(estado.restaurante.nome, "Restaurante Teste");
  } finally {
    await app.parar();
  }
});

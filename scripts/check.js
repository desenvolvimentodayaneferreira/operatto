// Confere a sintaxe de todos os arquivos JavaScript do Operatto.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const pastas = ["electron", "servidor", "web/js", "web/js/telas", "scripts", "testes"];
let falhou = false;
for (const pasta of pastas) {
  const completa = path.join(raiz, pasta);
  if (!fs.existsSync(completa)) continue;
  for (const nome of fs.readdirSync(completa).filter((n) => n.endsWith(".js"))) {
    const arquivo = path.join(completa, nome);
    try {
      execFileSync(process.execPath, ["--check", arquivo], { stdio: "pipe" });
      console.log(`ok   ${pasta}/${nome}`);
    } catch (erro) {
      falhou = true;
      console.error(`ERRO ${pasta}/${nome}\n${erro.stderr}`);
    }
  }
}
process.exit(falhou ? 1 : 0);

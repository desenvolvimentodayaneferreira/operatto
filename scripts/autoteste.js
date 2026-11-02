// Autoteste do programa: abre o Operatto com dados temporários, confere servidor, banco e tela, e fecha.
// Uso: npm run autoteste            (código-fonte; modo caixa principal)
//      OPERATTO_MODO=terminal OPERATTO_SERVIDOR=http://IP:8787 npm run autoteste   (modo outro computador)
//      npm run autoteste -- "caminho\Operatto.exe"   (programa instalado)
const { spawn } = require("node:child_process");
const path = require("node:path");

const raiz = path.join(__dirname, "..");
const alvo = process.argv[2];
const filho = spawn(alvo || require("electron"), alvo ? [] : [raiz], { cwd: raiz, env: { ...process.env, OPERATTO_AUTOTESTE: "1" } });
let saida = "";
filho.stdout.on("data", (d) => (saida += d));
filho.stderr.on("data", (d) => (saida += d));
const limite = setTimeout(() => { filho.kill(); console.error("ERRO: o programa não respondeu em 90 segundos."); process.exit(1); }, 90000);
filho.on("exit", () => {
  clearTimeout(limite);
  const linha = saida.split(/\r?\n/).find((l) => l.startsWith("AUTOTESTE "));
  if (!linha) { console.error(`ERRO: autoteste não terminou.\n${saida.slice(-1500)}`); process.exit(1); }
  const r = JSON.parse(linha.slice(10));
  console.log(JSON.stringify(r, null, 2));
  const ok = !r.falha && r.estado?.restaurante && (r.modo === "terminal" ? /^http/.test(r.url) && !/sem-servidor/.test(r.url) : r.porta && r.produtos > 0);
  console.log(ok ? "AUTOTESTE OK" : "AUTOTESTE FALHOU");
  process.exit(ok ? 0 : 1);
});

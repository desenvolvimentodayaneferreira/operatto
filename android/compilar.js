// Compila o aplicativo Android do Operatto sem Gradle: aapt2 → javac → d8 → zipalign → apksigner.
// Uso: node android/compilar.js      (ferramentas em C:\Users\<você>\Android ou em ANDROID_SDK_HOME/JAVA_HOME)
// Resultado: android/saida/Operatto-<versão>.apk
const { execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PASTA = __dirname;
const FERRAMENTAS = process.env.OPERATTO_ANDROID || path.join(os.homedir(), "Android");
const JDK = process.env.JAVA_HOME || path.join(FERRAMENTAS, "jdk");
const SDK = process.env.ANDROID_SDK_HOME || path.join(FERRAMENTAS, "sdk");
const BUILD_TOOLS = path.join(SDK, "build-tools", "36.0.0");
const ANDROID_JAR = path.join(SDK, "platforms", "android-36", "android.jar");
const VERSAO = require("../package.json").version;
const CODIGO_VERSAO = VERSAO.split(".").reduce((n, parte) => n * 100 + Number(parte), 0); // 0.2.0 → 200

// As ferramentas nativas do Android (aapt2, zipalign) não aceitam acentos no caminho ("Área de Trabalho"),
// então a compilação acontece numa cópia em pasta sem acento e só o resultado volta para cá.
const build = path.join(FERRAMENTAS, "build-operatto");
const fontesApp = path.join(build, "app");
const saida = path.join(PASTA, "saida");
const assinatura = path.join(PASTA, "assinatura");
const exe = (nome) => path.join(BUILD_TOOLS, process.platform === "win32" ? (/^(d8|apksigner)$/.test(nome) ? `${nome}.bat` : `${nome}.exe`) : nome);
const java = (nome) => path.join(JDK, "bin", process.platform === "win32" ? `${nome}.exe` : nome);
const env = { ...process.env, JAVA_HOME: JDK, PATH: `${path.join(JDK, "bin")}${path.delimiter}${process.env.PATH}` };

function passo(titulo, comando, args) {
  console.log(`\n▶ ${titulo}`);
  const usarShell = false; // tudo é chamado direto (os .bat do Google travam em alguns Windows)
  const linha = usarShell ? [`"${comando}"`, ...args.map((a) => (/[\s&()]/.test(a) ? `"${a}"` : a))].join(" ") : null;
  execFileSync(usarShell ? linha : comando, usarShell ? [] : args, { stdio: "inherit", env, shell: usarShell });
}

function arquivos(pasta, extensao) {
  return fs.readdirSync(pasta, { withFileTypes: true }).flatMap((item) => {
    const caminho = path.join(pasta, item.name);
    return item.isDirectory() ? arquivos(caminho, extensao) : caminho.endsWith(extensao) ? [caminho] : [];
  });
}

for (const [nome, caminho] of [["JDK", java("javac")], ["build-tools 36.0.0", exe("aapt2")], ["Android 16 (android.jar)", ANDROID_JAR]]) {
  if (!fs.existsSync(caminho)) throw new Error(`Não encontrei ${nome} em ${caminho}`);
}

fs.rmSync(build, { recursive: true, force: true });
for (const pasta of [build, path.join(build, "gen"), path.join(build, "classes"), path.join(build, "dex"), saida, assinatura]) fs.mkdirSync(pasta, { recursive: true });
for (const item of ["AndroidManifest.xml", "res", "assets", "src"]) fs.cpSync(path.join(PASTA, item), path.join(fontesApp, item), { recursive: true });

// 1. Chave de assinatura (criada uma única vez; a MESMA chave é necessária para atualizar o app nos celulares).
const chave = path.join(assinatura, "operatto.jks");
const senhaArquivo = path.join(assinatura, "senha.txt");
if (!fs.existsSync(chave)) {
  fs.writeFileSync(senhaArquivo, crypto.randomBytes(18).toString("base64url"));
  passo("Criando a chave de assinatura do aplicativo (uma única vez)", java("keytool"), [
    "-genkeypair", "-keystore", chave, "-alias", "operatto", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
    "-storepass:file", senhaArquivo, "-keypass:file", senhaArquivo, "-dname", "CN=Operatto by KAI, O=KAI - Kaelor Artificial Intelligence, C=BR",
  ]);
}

// 2. Recursos (nome, tema, ícones) e manifesto.
passo("Compilando os recursos (ícones, tema, textos)", exe("aapt2"), ["compile", "--dir", path.join(fontesApp, "res"), "-o", path.join(build, "recursos.zip")]);
passo("Montando o pacote base com o manifesto e a tela de conexão", exe("aapt2"), [
  "link", "-o", path.join(build, "base.apk"), "-I", ANDROID_JAR, "--manifest", path.join(fontesApp, "AndroidManifest.xml"),
  "-A", path.join(fontesApp, "assets"), "--java", path.join(build, "gen"), "--min-sdk-version", "24", "--target-sdk-version", "36",
  "--version-code", String(CODIGO_VERSAO), "--version-name", VERSAO, path.join(build, "recursos.zip"),
]);

// 3. Código Java → bytecode → formato do Android (dex).
const fontes = [...arquivos(path.join(fontesApp, "src"), ".java"), ...arquivos(path.join(build, "gen"), ".java")];
passo("Compilando o código Java", java("javac"), ["--release", "11", "-encoding", "UTF-8", "-nowarn", "-classpath", ANDROID_JAR, "-d", path.join(build, "classes"), ...fontes]);
passo("Convertendo para o formato do Android (d8)", java("java"), ["-cp", path.join(BUILD_TOOLS, "lib", "d8.jar"), "com.android.tools.r8.D8", "--release", "--min-api", "24", "--lib", ANDROID_JAR, "--output", path.join(build, "dex"), ...arquivos(path.join(build, "classes"), ".class")]);

// 4. Junta o código ao pacote, alinha e assina.
const semAssinatura = path.join(build, "sem-assinatura.apk");
fs.copyFileSync(path.join(build, "base.apk"), semAssinatura);
console.log("\n▶ Juntando o código ao pacote");
execFileSync(java("jar"), ["uMf", semAssinatura, "-C", path.join(build, "dex"), "classes.dex"], { stdio: "inherit", env });
const alinhado = path.join(build, "alinhado.apk");
passo("Alinhando o pacote (zipalign)", exe("zipalign"), ["-p", "-f", "4", semAssinatura, alinhado]);
const assinado = path.join(build, "assinado.apk");
const chaveTemp = path.join(build, "chave.jks");
const senhaTemp = path.join(build, "senha.txt");
fs.copyFileSync(chave, chaveTemp);
// O apksigner lê uma linha do arquivo para cada senha (repositório e chave), então a senha vai em duas linhas.
const senha = fs.readFileSync(senhaArquivo, "utf8").trim();
fs.writeFileSync(senhaTemp, `${senha}
${senha}
`);
try {
  passo("Assinando o aplicativo (apksigner)", java("java"), ["-jar", path.join(BUILD_TOOLS, "lib", "apksigner.jar"), "sign", "--ks", chaveTemp, "--ks-key-alias", "operatto", "--ks-pass", `file:${senhaTemp}`, "--key-pass", `file:${senhaTemp}`, "--out", assinado, alinhado]);
} finally {
  fs.rmSync(chaveTemp, { force: true });
  fs.rmSync(senhaTemp, { force: true });
}
passo("Conferindo a assinatura", java("java"), ["-jar", path.join(BUILD_TOOLS, "lib", "apksigner.jar"), "verify", "--verbose", assinado]);
const final = path.join(saida, `Operatto-${VERSAO}.apk`);
fs.copyFileSync(assinado, final);

console.log(`\n✔ Aplicativo pronto: ${final} (${(fs.statSync(final).size / 1024).toFixed(0)} KB)`);

// Acesso: configuração inicial, login por PIN, sessões dos aparelhos e cadastro da equipe.
const crypto = require("node:crypto");
const { ErroHttp } = require("./http");

const PAPEIS = ["gerente", "caixa", "garcom", "cozinha", "entregador"];
const MAX_TENTATIVAS = 5;
const BLOQUEIO_MS = 5 * 60 * 1000;
const SESSAO_MS = 16 * 60 * 60 * 1000; // um turno longo; depois pede o PIN de novo

const exigir = (condicao, mensagem, status = 400) => {
  if (!condicao) throw new ErroHttp(status, mensagem);
};

function hashPin(pin, sal = crypto.randomBytes(16).toString("hex")) {
  return { sal, hash: crypto.scryptSync(String(pin), sal, 32).toString("hex") };
}

function pinValido(pin) {
  return /^\d{4,6}$/.test(String(pin || ""));
}

function registrar(banco, sessao, acao, detalhe = "") {
  banco.exec("insert into auditoria (usuario_id, usuario_nome, acao, detalhe, criado_em) values (?, ?, ?, ?, ?)",
    sessao?.usuario.id ?? null, sessao?.usuario.nome ?? "Sistema", acao, detalhe, Date.now());
}

function criarAcesso(banco) {
  function autenticar(token) {
    if (!token) return null;
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    const linha = banco.um(`select s.token_hash, s.dispositivo, s.ultimo_uso, u.id, u.nome, u.papel, u.setor, u.ativo
      from sessoes s join usuarios u on u.id = s.usuario_id where s.token_hash = ?`, hash);
    if (!linha || !linha.ativo || Date.now() - linha.ultimo_uso > SESSAO_MS) return null;
    if (Date.now() - linha.ultimo_uso > 60000) banco.exec("update sessoes set ultimo_uso = ? where token_hash = ?", Date.now(), hash);
    return { tokenHash: hash, dispositivo: linha.dispositivo, usuario: { id: linha.id, nome: linha.nome, papel: linha.papel, setor: linha.setor } };
  }

  function rotas(rota) {
    rota("GET", "/api/estado", { publica: true }, () => ({
      configurado: Boolean(banco.um("select 1 from usuarios where papel = 'gerente' and ativo = 1")),
      restaurante: banco.config("restaurante", { nome: "Restaurante" }),
    }));

    rota("POST", "/api/configurar", { publica: true }, ({ corpo }) => {
      exigir(!banco.um("select 1 from usuarios where papel = 'gerente'"), "O sistema já foi configurado.", 409);
      exigir(String(corpo.restaurante || "").trim(), "Informe o nome do restaurante.");
      exigir(String(corpo.nome || "").trim(), "Informe o nome do gerente.");
      exigir(pinValido(corpo.pin), "O PIN deve ter de 4 a 6 números.");
      const { hash, sal } = hashPin(corpo.pin);
      banco.transacao(() => {
        banco.salvarConfig("restaurante", { nome: corpo.restaurante.trim() });
        banco.exec("insert into usuarios (nome, papel, pin_hash, pin_sal, criado_em) values (?, 'gerente', ?, ?, ?)", corpo.nome.trim(), hash, sal, Date.now());
      });
      registrar(banco, null, "Configuração inicial", corpo.restaurante.trim());
      return { ok: true };
    });

    // Lista curta para a tela de login (toque no nome e digite o PIN).
    rota("GET", "/api/equipe-login", { publica: true }, () =>
      banco.todos("select id, nome, papel from usuarios where ativo = 1 order by case papel when 'gerente' then 0 when 'caixa' then 1 when 'garcom' then 2 else 3 end, nome"));

    rota("POST", "/api/login", { publica: true }, ({ corpo }) => {
      const usuario = banco.um("select * from usuarios where id = ? and ativo = 1", Number(corpo.usuario_id));
      exigir(usuario, "Usuário não encontrado.", 404);
      exigir(!usuario.bloqueado_ate || usuario.bloqueado_ate < Date.now(), "Muitas tentativas erradas. Aguarde 5 minutos ou peça ao gerente.", 423);
      const { hash } = hashPin(corpo.pin, usuario.pin_sal);
      const certo = crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(usuario.pin_hash, "hex"));
      if (!certo) {
        const tentativas = usuario.tentativas + 1;
        banco.exec("update usuarios set tentativas = ?, bloqueado_ate = ? where id = ?", tentativas >= MAX_TENTATIVAS ? 0 : tentativas, tentativas >= MAX_TENTATIVAS ? Date.now() + BLOQUEIO_MS : null, usuario.id);
        if (tentativas >= MAX_TENTATIVAS) registrar(banco, null, "Bloqueio por PIN errado", usuario.nome);
        throw new ErroHttp(401, tentativas >= MAX_TENTATIVAS ? "PIN errado 5 vezes. Acesso bloqueado por 5 minutos." : `PIN incorreto. Restam ${MAX_TENTATIVAS - tentativas} tentativa(s).`);
      }
      const token = crypto.randomBytes(32).toString("hex");
      const agora = Date.now();
      banco.exec("update usuarios set tentativas = 0, bloqueado_ate = null where id = ?", usuario.id);
      banco.exec("insert into sessoes (token_hash, usuario_id, dispositivo, criado_em, ultimo_uso) values (?, ?, ?, ?, ?)",
        crypto.createHash("sha256").update(token).digest("hex"), usuario.id, String(corpo.dispositivo || "").slice(0, 80), agora, agora);
      banco.exec("delete from sessoes where ultimo_uso < ?", agora - SESSAO_MS);
      return { token, usuario: { id: usuario.id, nome: usuario.nome, papel: usuario.papel, setor: usuario.setor } };
    });

    rota("POST", "/api/sair", ({ sessao }) => {
      banco.exec("delete from sessoes where token_hash = ?", sessao.tokenHash);
    });

    rota("GET", "/api/eu", ({ sessao }) => sessao.usuario);

    // ---------- Equipe (gerente) ----------
    rota("GET", "/api/usuarios", { papeis: ["gerente"] }, () =>
      banco.todos("select id, nome, papel, setor, ativo, criado_em, (bloqueado_ate > ?) as bloqueado from usuarios order by ativo desc, nome", Date.now()));

    rota("POST", "/api/usuarios", { papeis: ["gerente"] }, ({ corpo, sessao }) => {
      exigir(String(corpo.nome || "").trim(), "Informe o nome.");
      exigir(PAPEIS.includes(corpo.papel), "Perfil inválido.");
      exigir(pinValido(corpo.pin), "O PIN deve ter de 4 a 6 números.");
      const { hash, sal } = hashPin(corpo.pin);
      const r = banco.exec("insert into usuarios (nome, papel, setor, pin_hash, pin_sal, criado_em) values (?, ?, ?, ?, ?, ?)",
        corpo.nome.trim(), corpo.papel, corpo.setor || null, hash, sal, Date.now());
      registrar(banco, sessao, "Cadastro de usuário", `${corpo.nome.trim()} (${corpo.papel})`);
      return { id: Number(r.lastInsertRowid) };
    });

    rota("PUT", "/api/usuarios/:id", { papeis: ["gerente"] }, ({ params, corpo, sessao }) => {
      const usuario = banco.um("select * from usuarios where id = ?", Number(params.id));
      exigir(usuario, "Usuário não encontrado.", 404);
      exigir(!corpo.papel || PAPEIS.includes(corpo.papel), "Perfil inválido.");
      if (usuario.papel === "gerente" && (corpo.papel && corpo.papel !== "gerente" || corpo.ativo === false)) {
        const gerentes = banco.um("select count(*) as n from usuarios where papel = 'gerente' and ativo = 1").n;
        exigir(gerentes > 1, "É preciso manter pelo menos um gerente ativo.");
      }
      const campos = { nome: corpo.nome?.trim() || usuario.nome, papel: corpo.papel || usuario.papel, setor: corpo.setor === undefined ? usuario.setor : corpo.setor || null, ativo: corpo.ativo === undefined ? usuario.ativo : corpo.ativo ? 1 : 0 };
      banco.exec("update usuarios set nome = ?, papel = ?, setor = ?, ativo = ? where id = ?", campos.nome, campos.papel, campos.setor, campos.ativo, usuario.id);
      if (corpo.pin) {
        exigir(pinValido(corpo.pin), "O PIN deve ter de 4 a 6 números.");
        const { hash, sal } = hashPin(corpo.pin);
        banco.exec("update usuarios set pin_hash = ?, pin_sal = ?, tentativas = 0, bloqueado_ate = null where id = ?", hash, sal, usuario.id);
      }
      if (corpo.desbloquear) banco.exec("update usuarios set tentativas = 0, bloqueado_ate = null where id = ?", usuario.id);
      if (!campos.ativo || corpo.pin) banco.exec("delete from sessoes where usuario_id = ?", usuario.id);
      registrar(banco, sessao, "Alteração de usuário", campos.nome);
    });

    rota("GET", "/api/entregadores", { papeis: ["gerente", "caixa"] }, () =>
      banco.todos("select id, nome from usuarios where papel = 'entregador' and ativo = 1 order by nome"));

    rota("GET", "/api/auditoria", { papeis: ["gerente"] }, ({ query }) =>
      banco.todos("select * from auditoria order by id desc limit ?", Math.min(500, Number(query.get("limite")) || 200)));
  }

  return { autenticar, rotas };
}

module.exports = { criarAcesso, registrar, exigir, PAPEIS };

"use strict";

// Entrada: configuração inicial (primeiro uso) e login tocando no nome + PIN.
(() => {
  const { $, $$, esc, api, aviso, PAPEL } = OP;

  const cabecalho = () => `
    <div class="login-marca">
      <img src="assets/logo.svg" alt="Operatto" />
      <div><b>OPERATTO</b><small>Gestão para restaurantes · by KAI</small></div>
    </div>`;

  function configurar(raiz) {
    raiz.innerHTML = `
      <div class="login">
        ${cabecalho()}
        <form class="cartao login-cartao" novalidate>
          <h1>Primeira configuração</h1>
          <p class="sutil">Cadastre o restaurante e o gerente. Os demais usuários são cadastrados depois, em Equipe.</p>
          <label>Nome do restaurante<input name="restaurante" value="Restaurante Exemplo" required /></label>
          <label>Seu nome (gerente)<input name="nome" required autocomplete="off" /></label>
          <label>PIN de acesso (4 a 6 números)<input name="pin" type="password" inputmode="numeric" maxlength="6" required /></label>
          <label>Repita o PIN<input name="pin2" type="password" inputmode="numeric" maxlength="6" required /></label>
          <p class="erro" role="alert"></p>
          <button class="btn primario grande" type="submit">Começar</button>
        </form>
      </div>`;
    const form = $("form", raiz);
    form.addEventListener("submit", async (evento) => {
      evento.preventDefault();
      const erro = $(".erro", form);
      erro.textContent = "";
      const dados = Object.fromEntries(new FormData(form));
      if (dados.pin !== dados.pin2) return (erro.textContent = "Os PINs não conferem.");
      try {
        await api("POST", "/api/configurar", { restaurante: dados.restaurante, nome: dados.nome, pin: dados.pin });
        const equipe = await api("GET", "/api/equipe-login");
        const sessao = await api("POST", "/api/login", { usuario_id: equipe[0].id, pin: dados.pin, dispositivo: navigator.userAgent });
        OP.estado.restaurante = { nome: dados.restaurante };
        await OP.app.entrar(sessao);
        aviso("Sistema configurado. Cadastre a equipe em Equipe.");
      } catch (problema) {
        erro.textContent = problema.message;
      }
    });
  }

  async function abrir(raiz) {
    const equipe = await api("GET", "/api/equipe-login");
    raiz.innerHTML = `
      <div class="login">
        ${cabecalho()}
        <div class="cartao login-cartao">
          <h1>${esc(OP.estado.restaurante?.nome || "Entrar")}</h1>
          <p class="sutil">Toque no seu nome</p>
          <div class="equipe">${equipe.map((u) => `<button class="pessoa" data-id="${u.id}"><span>${esc(u.nome[0])}</span><b>${esc(u.nome)}</b><small>${PAPEL[u.papel]}</small></button>`).join("")}</div>
        </div>
      </div>`;
    $$(".pessoa", raiz).forEach((botao) => botao.addEventListener("click", () => pedirPin(equipe.find((u) => u.id === Number(botao.dataset.id)))));
  }

  function pedirPin(usuario) {
    let pin = "";
    const dialogo = OP.janela(`
      <div class="form-janela pin-janela">
        <header class="janela-topo"><h2>${esc(usuario.nome)}</h2><button class="btn-icone" data-fechar aria-label="Fechar">✕</button></header>
        <p class="sutil">Digite seu PIN</p>
        <div class="pin-pontos">${"<i></i>".repeat(6)}</div>
        <p class="erro" role="alert"></p>
        <div class="teclado">${[1, 2, 3, 4, 5, 6, 7, 8, 9, "⌫", 0, "OK"].map((t) => `<button type="button" data-tecla="${t}">${t}</button>`).join("")}</div>
      </div>`, { classe: "janela-pin" });
    const pontos = $$(".pin-pontos i", dialogo);
    const erro = $(".erro", dialogo);
    const desenhar = () => pontos.forEach((p, i) => p.classList.toggle("cheio", i < pin.length));

    async function enviar() {
      if (pin.length < 4) return (erro.textContent = "O PIN tem pelo menos 4 números.");
      try {
        const sessao = await api("POST", "/api/login", { usuario_id: usuario.id, pin, dispositivo: navigator.userAgent.slice(0, 80) });
        dialogo.close();
        await OP.app.entrar(sessao);
      } catch (problema) {
        erro.textContent = problema.message;
        pin = "";
        desenhar();
        dialogo.querySelector(".pin-pontos").classList.add("tremer");
        setTimeout(() => dialogo.querySelector(".pin-pontos")?.classList.remove("tremer"), 400);
      }
    }
    function tecla(t) {
      erro.textContent = "";
      if (t === "⌫") pin = pin.slice(0, -1);
      else if (t === "OK") return enviar();
      else if (pin.length < 6) pin += t;
      desenhar();
    }
    dialogo.addEventListener("click", (evento) => {
      const botao = evento.target.closest("[data-tecla]");
      if (botao) tecla(botao.dataset.tecla);
    });
    dialogo.addEventListener("keydown", (evento) => {
      if (/^\d$/.test(evento.key)) tecla(evento.key);
      else if (evento.key === "Backspace") tecla("⌫");
      else if (evento.key === "Enter") tecla("OK");
    });
  }

  OP.telas.login = { abrir, configurar };
})();

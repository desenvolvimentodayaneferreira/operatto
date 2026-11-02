"use strict";

// Telas do gerente: painel do dia, cardápio, equipe e configurações (mesas, bairros, aparelhos).
(() => {
  const { $, $$, esc, api, dinheiro, paraCampo, dataHora, aviso, PAPEL } = OP;

  // ---------- Painel do dia ----------
  OP.telas.painel = {
    async abrir(raiz) {
      this.raiz = raiz;
      await this.carregar();
    },
    async carregar() {
      const r = await api("GET", "/api/resumo-dia");
      const maior = Math.max(1, ...r.porHora);
      const horas = r.porHora.map((v, h) => ({ v, h })).filter(({ h }) => h >= 10 || r.porHora[h] > 0);
      const tipos = { mesa: "Salão", balcao: "Balcão", delivery: "Delivery" };
      this.raiz.innerHTML = `
        <div class="titulo-tela"><div><h1>Olá, ${esc(OP.estado.usuario.nome.split(" ")[0])}!</h1><p>Resumo de hoje · ${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</p></div></div>
        ${OP.estado.sistema?.cardapioExemplo ? '<div class="alerta">O cardápio atual é de <b>exemplo</b>. Cadastre o cardápio real da casa em <a href="#/cardapio">Cardápio</a>.</div>' : ""}
        <div class="numeros">
          <div class="numero destaque"><small>Vendas hoje</small><b>${dinheiro(r.vendas)}</b><span>${r.pedidos} conta(s) fechada(s)</span></div>
          <div class="numero"><small>Ticket médio</small><b>${dinheiro(r.ticketMedio)}</b></div>
          <div class="numero"><small>Mesas ocupadas</small><b>${r.mesasOcupadas} / ${r.mesasTotal}</b><span>${r.mesasTotal ? Math.round((r.mesasOcupadas / r.mesasTotal) * 100) : 0}% de ocupação</span></div>
          <div class="numero"><small>Na cozinha agora</small><b>${r.cozinhaPendentes}</b><span>item(ns) em preparo ou na fila</span></div>
        </div>
        <div class="duas-colunas">
          <section class="cartao">
            <h2>Vendas por hora</h2>
            <div class="barras">${horas.map(({ v, h }) => `<div class="barra" title="${h}h: ${dinheiro(v)}"><span style="height:${Math.round((v / maior) * 100)}%"></span><small>${h}h</small></div>`).join("")}</div>
            <div class="linha-tipos">${r.porTipo.map((t) => `<div><small>${tipos[t.tipo]}</small><b>${dinheiro(t.total)}</b></div>`).join("")}</div>
          </section>
          <section class="cartao">
            <h2>Mais vendidos hoje</h2>
            ${r.maisVendidos.length ? `<table class="tabela"><tbody>${r.maisVendidos.map((i) => `<tr><td>${esc(i.nome)}</td><td>${i.quantidade}</td><td>${dinheiro(i.valor)}</td></tr>`).join("")}</tbody></table>` : '<p class="sutil">Ainda sem vendas hoje.</p>'}
            ${r.cancelados ? `<p class="sutil">${r.cancelados} item(ns) cancelado(s) hoje · veja em Configurações → Registro de ações.</p>` : ""}
          </section>
        </div>`;
    },
    aoEvento(tipo) {
      if (["caixa", "pedido", "mesas"].includes(tipo) && this.raiz?.isConnected) this.carregar().catch(() => {});
    },
  };

  // ---------- Cardápio ----------
  OP.telas.cardapio = {
    async abrir(raiz) {
      this.raiz = raiz;
      await this.carregar();
    },
    async carregar() {
      const c = await api("GET", "/api/cardapio?todos=1");
      this.dados = c;
      const setor = (id) => c.setores.find((s) => s.id === id)?.nome || "Sem preparo";
      this.raiz.innerHTML = `
        <div class="titulo-tela">
          <div><h1>Cardápio</h1><p>${c.produtos.filter((p) => p.ativo).length} produtos ativos em ${c.categorias.filter((k) => k.ativo).length} categorias</p></div>
          <div class="acoes-linha"><button class="btn" data-nova-categoria>+ Categoria</button><button class="btn primario" data-novo-produto>+ Produto</button></div>
        </div>
        ${OP.estado.sistema?.cardapioExemplo ? '<div class="alerta">Cardápio de exemplo com preços ilustrativos. Edite os produtos ou cadastre o cardápio real.<button class="btn pequeno" data-cardapio-real>Já cadastrei o cardápio real</button></div>' : ""}
        ${c.categorias.map((k) => `
          <section class="cartao ${k.ativo ? "" : "inativo"}">
            <div class="cartao-topo">
              <h2>${esc(k.nome)} <small>${setor(k.setor_id)}${k.meio_a_meio ? " · aceita meio a meio" : ""}${k.ativo ? "" : " · inativa"}</small></h2>
              <button class="link" data-categoria="${k.id}">editar</button>
            </div>
            <table class="tabela"><tbody>
              ${c.produtos.filter((p) => p.categoria_id === k.id).map((p) => `
                <tr class="${p.ativo ? "" : "inativo"}">
                  <td><b>${esc(p.nome)}</b>${p.descricao ? `<br><small>${esc(p.descricao)}</small>` : ""}</td>
                  <td>${dinheiro(p.preco)}</td>
                  <td><label class="interruptor"><input type="checkbox" data-disponivel="${p.id}" ${p.disponivel ? "checked" : ""} ${p.ativo ? "" : "disabled"}/> ${p.disponivel ? "Disponível" : "Esgotado"}</label></td>
                  <td><button class="link" data-produto="${p.id}">editar</button></td>
                </tr>`).join("") || '<tr><td class="sutil">Nenhum produto.</td></tr>'}
            </tbody></table>
          </section>`).join("")}`;
      this.ligar();
    },
    ligar() {
      const r = this.raiz;
      $("[data-nova-categoria]", r).addEventListener("click", () => this.categoria());
      $("[data-novo-produto]", r).addEventListener("click", () => this.produto());
      $("[data-cardapio-real]", r)?.addEventListener("click", async () => {
        await api("PUT", "/api/sistema/config", { cardapio_exemplo: false });
        OP.estado.sistema.cardapioExemplo = false;
        this.carregar();
      });
      $$("[data-categoria]", r).forEach((b) => b.addEventListener("click", () => this.categoria(this.dados.categorias.find((k) => k.id === Number(b.dataset.categoria)))));
      $$("[data-produto]", r).forEach((b) => b.addEventListener("click", () => this.produto(this.dados.produtos.find((p) => p.id === Number(b.dataset.produto)))));
      $$("[data-disponivel]", r).forEach((b) => b.addEventListener("change", async () => {
        await api("POST", `/api/produtos/${b.dataset.disponivel}/disponivel`, { disponivel: b.checked });
        this.carregar();
      }));
    },
    categoria(k) {
      const setores = this.dados.setores.map((s) => ({ valor: s.id, rotulo: s.nome }));
      OP.formulario({
        titulo: k ? `Editar ${k.nome}` : "Nova categoria",
        campos: [
          { nome: "nome", rotulo: "Nome", obrigatorio: true },
          { nome: "setor_id", rotulo: "Onde é preparado", tipo: "select", opcoes: setores, vazio: "Sem preparo (sai direto, ex.: refrigerante)" },
          { nome: "ordem", rotulo: "Ordem no cardápio", tipo: "numero" },
          { nome: "meio_a_meio", rotulo: "Permite meio a meio (pizzas)", tipo: "checkbox" },
          ...(k ? [{ nome: "ativo", rotulo: "Categoria ativa", tipo: "checkbox" }] : []),
        ],
        valores: k || { ordem: this.dados.categorias.length + 1 },
        salvar: async (d) => {
          const corpo = { ...d, setor_id: d.setor_id ? Number(d.setor_id) : null };
          if (k) await api("PUT", `/api/categorias/${k.id}`, corpo);
          else await api("POST", "/api/categorias", corpo);
          this.carregar();
        },
      });
    },
    produto(p) {
      const c = this.dados;
      OP.formulario({
        titulo: p ? `Editar ${p.nome}` : "Novo produto",
        campos: [
          { nome: "nome", rotulo: "Nome", obrigatorio: true, largo: true },
          { nome: "categoria_id", rotulo: "Categoria", tipo: "select", opcoes: c.categorias.map((k) => ({ valor: k.id, rotulo: k.nome })) },
          { nome: "preco", rotulo: "Preço (R$)", tipo: "dinheiro", obrigatorio: true },
          { nome: "tamanho", rotulo: "Tamanho (pizzas: P, M, G)", ajuda: "Sabores só combinam no meio a meio se forem do mesmo tamanho." },
          { nome: "descricao", rotulo: "Descrição", tipo: "textarea", largo: true },
          { nome: "setor_id", rotulo: "Preparo (se diferente da categoria)", tipo: "select", opcoes: c.setores.map((s) => ({ valor: s.id, rotulo: s.nome })), vazio: "Igual à categoria" },
          { nome: "codigo", rotulo: "Código interno" },
          { nome: "ncm", rotulo: "NCM (fiscal)", ajuda: "Informado pelo contador; usado na NFC-e." },
          { nome: "cfop", rotulo: "CFOP (fiscal)" },
          { nome: "csosn", rotulo: "CSOSN (fiscal)" },
          ...(p ? [{ nome: "ativo", rotulo: "Produto ativo no cardápio", tipo: "checkbox" }] : []),
        ],
        valores: p || { categoria_id: c.categorias[0]?.id },
        salvar: async (d) => {
          const corpo = { ...d, categoria_id: Number(d.categoria_id), setor_id: d.setor_id ? Number(d.setor_id) : null, disponivel: p ? p.disponivel : 1 };
          if (p) await api("PUT", `/api/produtos/${p.id}`, corpo);
          else await api("POST", "/api/produtos", corpo);
          aviso("Cardápio atualizado. Os celulares já recebem a mudança.");
          this.carregar();
        },
      });
    },
    aoEvento(tipo) {
      if (tipo === "cardapio" && !document.querySelector("dialog[open]")) this.carregar().catch(() => {});
    },
  };

  // ---------- Equipe ----------
  OP.telas.equipe = {
    async abrir(raiz) {
      this.raiz = raiz;
      await this.carregar();
    },
    async carregar() {
      const [usuarios, cardapio] = await Promise.all([api("GET", "/api/usuarios"), api("GET", "/api/cardapio")]);
      this.setores = cardapio.setores;
      this.usuarios = usuarios;
      this.raiz.innerHTML = `
        <div class="titulo-tela"><div><h1>Equipe</h1><p>Cada pessoa entra com o próprio PIN. Tudo o que fazem fica registrado.</p></div><button class="btn primario" data-novo>+ Pessoa</button></div>
        <section class="cartao"><table class="tabela">
          <thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th></th></tr></thead>
          <tbody>${usuarios.map((u) => `<tr class="${u.ativo ? "" : "inativo"}"><td><b>${esc(u.nome)}</b></td><td>${PAPEL[u.papel]}${u.papel === "cozinha" && u.setor ? ` · ${esc(this.setores.find((s) => s.id === Number(u.setor))?.nome || "")}` : ""}</td>
            <td>${u.bloqueado ? '<span class="status-item cancelado">Bloqueado</span>' : u.ativo ? '<span class="status-item entregue">Ativo</span>' : "Inativo"}</td>
            <td><button class="link" data-editar="${u.id}">editar</button></td></tr>`).join("")}</tbody>
        </table></section>
        <section class="cartao"><h2>Perfis</h2><ul class="lista-simples">
          <li><b>Gerente</b> — tudo, inclusive cardápio, equipe, cancelamentos e relatórios.</li>
          <li><b>Caixa</b> — salão, balcão, delivery, recebimentos e caixa.</li>
          <li><b>Garçom</b> — abre mesas e lança pedidos pelo celular; vê quando o prato fica pronto.</li>
          <li><b>Cozinha</b> — tela de preparo (pode ficar fixa num setor: Pizzaria, Cozinha ou Bar).</li>
          <li><b>Entregador</b> — vê as entregas e marca saída e entrega.</li>
        </ul></section>`;
      $("[data-novo]", this.raiz).addEventListener("click", () => this.form());
      $$("[data-editar]", this.raiz).forEach((b) => b.addEventListener("click", () => this.form(usuarios.find((u) => u.id === Number(b.dataset.editar)))));
    },
    form(u) {
      OP.formulario({
        titulo: u ? `Editar ${u.nome}` : "Nova pessoa na equipe",
        campos: [
          { nome: "nome", rotulo: "Nome", obrigatorio: true },
          { nome: "papel", rotulo: "Perfil", tipo: "select", vazio: false, opcoes: Object.entries(PAPEL).map(([valor, rotulo]) => ({ valor, rotulo })) },
          { nome: "setor", rotulo: "Setor fixo (só cozinha)", tipo: "select", opcoes: this.setores.map((s) => ({ valor: s.id, rotulo: s.nome })), vazio: "Todos os setores" },
          { nome: "pin", rotulo: u ? "Novo PIN (deixe em branco para manter)" : "PIN (4 a 6 números)", tipo: "pin", obrigatorio: !u },
          ...(u ? [{ nome: "ativo", rotulo: "Ativo", tipo: "checkbox" }, ...(u.bloqueado ? [{ nome: "desbloquear", rotulo: "Desbloquear acesso", tipo: "checkbox" }] : [])] : []),
        ],
        valores: u ? { ...u, ativo: Boolean(u.ativo), setor: u.setor || "" } : { papel: "garcom" },
        salvar: async (d) => {
          const corpo = { ...d, setor: d.setor ? Number(d.setor) : null, pin: d.pin || undefined };
          if (u) await api("PUT", `/api/usuarios/${u.id}`, corpo);
          else await api("POST", "/api/usuarios", corpo);
          this.carregar();
        },
      });
    },
  };

  // ---------- Configurações ----------
  OP.telas.config = {
    async abrir(raiz) {
      this.raiz = raiz;
      await this.carregar();
    },
    async carregar() {
      const [sistema, bairros, mesas, auditoria] = await Promise.all([api("GET", "/api/sistema"), api("GET", "/api/bairros"), api("GET", "/api/mesas"), api("GET", "/api/auditoria?limite=80")]);
      OP.estado.sistema = sistema;
      const endereco = sistema.enderecos[0] ? `http://${sistema.enderecos[0].ip}:${sistema.porta}` : null;
      this.raiz.innerHTML = `
        <div class="titulo-tela"><div><h1>Configurações</h1><p>Operatto ${esc(sistema.versao)}</p></div></div>
        <div class="duas-colunas">
          <section class="cartao">
            <h2>Conectar celulares e tablets</h2>
            ${endereco ? `
              <div class="qr-conexao">
                <div class="qr">${(() => { const q = qrcode(0, "M"); q.addData(endereco); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); })()}</div>
                <div>
                  <p>No celular do garçom ou no tablet da cozinha, <b>conectado ao Wi-Fi do restaurante</b>, aponte a câmera para o código ou digite:</p>
                  <p class="endereco">${esc(endereco)}</p>
                  <p class="sutil">Depois toque em "Adicionar à tela inicial" para virar um ícone.${sistema.enderecos.length > 1 ? ` Outros endereços: ${sistema.enderecos.slice(1).map((e) => `${e.ip}`).join(", ")}` : ""}</p>
                </div>
              </div>` : '<div class="alerta">Este computador não está conectado a uma rede. Conecte ao Wi-Fi ou cabo do restaurante.</div>'}
            <h3>Instalar nos aparelhos</h3>
            <ul class="lista-simples">
              <li><b>Android:</b> leia o QR Code, entre com o PIN, toque nos ⋮ do Chrome → <b>Adicionar à tela inicial</b>.</li>
              <li><b>iPhone:</b> leia o QR Code, abra no Safari, toque em Compartilhar → <b>Adicionar à Tela de Início</b>.</li>
              <li><b>Outros computadores</b> (cozinha, gerência, segundo caixa): instale o mesmo instalador do Operatto e escolha <b>Outro computador</b> na primeira abertura; ele encontra este caixa sozinho.</li>
            </ul>
            ${sistema.conectados?.length ? `<h3>Conectados agora</h3><ul class="lista-simples">${sistema.conectados.map((c) => `<li>${esc(c.usuario)} · ${PAPEL[c.papel]}</li>`).join("")}</ul>` : ""}
          </section>
          <section class="cartao">
            <h2>Conta e atendimento</h2>
            <dl class="dados">
              <div><dt>Restaurante</dt><dd>${esc(OP.estado.restaurante?.nome || "")}</dd></div>
              <div><dt>Taxa de serviço (mesas)</dt><dd>${(sistema.taxaServicoPct / 10).toLocaleString("pt-BR")}%</dd></div>
              <div><dt>Mesas</dt><dd>${mesas.length}</dd></div>
            </dl>
            <div class="acoes-linha"><button class="btn" data-editar-conta>Editar</button><button class="btn" data-nova-mesa>+ Mesa</button></div>
            <h3>Bairros e taxas de entrega</h3>
            ${bairros.length ? `<table class="tabela"><tbody>${bairros.map((b) => `<tr><td>${esc(b.nome)}</td><td>${dinheiro(b.taxa)}</td><td><button class="link" data-bairro="${esc(b.nome)}" data-taxa="${b.taxa}">editar</button></td></tr>`).join("")}</tbody></table>` : '<p class="sutil">Nenhum bairro cadastrado.</p>'}
            <button class="btn" data-novo-bairro>+ Bairro</button>
          </section>
        </div>
        <section class="cartao">
          <h2>Registro de ações</h2>
          <table class="tabela"><thead><tr><th>Quando</th><th>Quem</th><th>Ação</th><th>Detalhe</th></tr></thead><tbody>
            ${auditoria.map((a) => `<tr><td>${dataHora(a.criado_em)}</td><td>${esc(a.usuario_nome || "")}</td><td>${esc(a.acao)}</td><td>${esc(a.detalhe || "")}</td></tr>`).join("")}
          </tbody></table>
        </section>`;
      this.ligar(sistema);
    },
    ligar(sistema) {
      const r = this.raiz;
      $("[data-editar-conta]", r).addEventListener("click", () => OP.formulario({
        titulo: "Conta e atendimento",
        campos: [{ nome: "restaurante", rotulo: "Nome do restaurante", obrigatorio: true, largo: true }, { nome: "taxa", rotulo: "Taxa de serviço nas mesas (%)", tipo: "numero", min: 0 }],
        valores: { restaurante: OP.estado.restaurante?.nome, taxa: sistema.taxaServicoPct / 10 },
        salvar: async (d) => {
          await api("PUT", "/api/sistema/config", { restaurante: d.restaurante, taxa_servico_pct: Math.round((d.taxa || 0) * 10) });
          OP.estado.restaurante = { nome: d.restaurante };
          this.carregar();
        },
      }));
      $("[data-nova-mesa]", r).addEventListener("click", () => OP.formulario({
        titulo: "Nova mesa",
        campos: [{ nome: "numero", rotulo: "Número", tipo: "numero", obrigatorio: true }, { nome: "lugares", rotulo: "Lugares", tipo: "numero" }],
        salvar: async (d) => { await api("POST", "/api/mesas", d); this.carregar(); },
      }));
      const bairro = (nome, taxa) => OP.formulario({
        titulo: nome ? `Bairro ${nome}` : "Novo bairro",
        campos: [{ nome: "nome", rotulo: "Bairro", obrigatorio: true }, { nome: "taxa", rotulo: "Taxa de entrega (R$)", tipo: "dinheiro", obrigatorio: true }],
        valores: { nome, taxa },
        salvar: async (d) => { await api("POST", "/api/bairros", d); this.carregar(); },
      });
      $("[data-novo-bairro]", r).addEventListener("click", () => bairro());
      $$("[data-bairro]", r).forEach((b) => b.addEventListener("click", () => bairro(b.dataset.bairro, Number(b.dataset.taxa))));
    },
  };
})();

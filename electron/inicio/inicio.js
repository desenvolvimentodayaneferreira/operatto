"use strict";

// Tela de primeira abertura: caixa principal ou outro computador (com busca automática na rede).
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function procurar() {
  $("#erro").textContent = "";
  $("#lista").innerHTML = '<div class="procurando">Procurando o caixa principal na rede…</div>';
  const servidores = await window.operatto.procurar();
  $("#lista").innerHTML = servidores.length
    ? servidores.map((s) => `<button class="servidor" data-endereco="${esc(s.endereco)}"><span>🖥️</span><b>${esc(s.nome)}</b><small>${esc(s.endereco)}</small></button>`).join("")
    : '<div class="procurando">Nenhum caixa principal encontrado. Confira se ele está ligado, com o Operatto aberto, e se este computador está na mesma rede. Você também pode digitar o endereço abaixo.</div>';
  document.querySelectorAll("[data-endereco]").forEach((b) => b.addEventListener("click", () => conectar(b.dataset.endereco)));
}

async function conectar(endereco) {
  $("#erro").textContent = "";
  try {
    await window.operatto.escolher({ modo: "terminal", servidor: endereco });
  } catch (erro) {
    $("#erro").textContent = erro.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
  }
}

document.querySelectorAll("[data-modo]").forEach((b) => b.addEventListener("click", async () => {
  if (b.dataset.modo === "servidor") return window.operatto.escolher({ modo: "servidor" });
  $("#escolha").hidden = true;
  $("#terminal").hidden = false;
  procurar();
}));
$("#procurar").addEventListener("click", procurar);
$("#voltar").addEventListener("click", () => { $("#terminal").hidden = true; $("#escolha").hidden = false; });
$("#usar").addEventListener("click", () => {
  let endereco = $("#endereco").value.trim();
  if (!endereco) return;
  if (!/^https?:\/\//i.test(endereco)) endereco = `http://${endereco}`;
  if (!/:\d+\/?$/.test(endereco)) endereco = `${endereco.replace(/\/$/, "")}:8787`;
  conectar(endereco.replace(/\/$/, ""));
});
if (location.hash === "#terminal") {
  $("#escolha").hidden = true;
  $("#terminal").hidden = false;
  procurar();
}

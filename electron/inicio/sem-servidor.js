"use strict";

// Tenta reconectar ao caixa principal sozinho; também permite escolher outro.
const tentar = () => window.operatto.reconectar();
document.querySelector("#tentar").addEventListener("click", tentar);
document.querySelector("#trocar").addEventListener("click", () => { location.href = "index.html#terminal"; });
setInterval(tentar, 10000);

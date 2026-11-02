// Ponte das telas locais de configuração do computador (busca na rede, escolha do modo, reconexão).
// Só é exposta nas páginas do próprio programa (file://), nunca nas telas vindas da rede.
const { contextBridge, ipcRenderer } = require("electron");

if (location.protocol === "file:") {
  contextBridge.exposeInMainWorld("operatto", {
    procurar: () => ipcRenderer.invoke("inicio:procurar"),
    escolher: (escolha) => ipcRenderer.invoke("inicio:escolher", escolha),
    reconectar: () => ipcRenderer.invoke("inicio:reconectar"),
  });
}

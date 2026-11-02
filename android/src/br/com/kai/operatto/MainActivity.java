package br.com.kai.operatto;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Operatto para Android.
 * - Primeira abertura: tela local (assets/inicio.html) que encontra o caixa principal na rede.
 * - Depois: abre o sistema do caixa em tela cheia; se o caixa sumir, volta para a tela de conexão.
 */
public class MainActivity extends Activity {
    private static final String TELA_INICIO = "file:///android_asset/inicio.html";
    private static final int PORTA_DESCOBERTA = 8786;

    private WebView web;
    private SharedPreferences prefs;
    private volatile String urlAtual = "";

    @Override
    protected void onCreate(Bundle estado) {
        super.onCreate(estado);
        prefs = getSharedPreferences("operatto", MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0C0B0E"));
        // Respeita a barra de status e a de navegação (Android 15+ desenha de borda a borda).
        web.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } else {
                v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // bipe de pedido pronto/novo pedido
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);

        web.addJavascriptInterface(new Ponte(), "OperattoApp");
        web.setWebViewClient(new Cliente());

        aplicarTelaLigada();
        String servidor = prefs.getString("servidor", null);
        web.loadUrl(servidor != null ? servidor + "/" : TELA_INICIO);
    }

    private boolean naTelaInicio() {
        return urlAtual.startsWith("file:///android_asset/");
    }

    private void aplicarTelaLigada() {
        if (prefs.getBoolean("telaLigada", false)) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    private void abrirInicio(String motivo) {
        web.loadUrl(TELA_INICIO + (motivo != null ? "#" + Uri.encode(motivo) : ""));
    }

    @Override
    public void onBackPressed() {
        if (naTelaInicio()) {
            super.onBackPressed();
            return;
        }
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("Operatto")
            .setItems(new String[] { "Trocar de caixa / configurações", "Fechar o Operatto", "Continuar" }, (d, qual) -> {
                if (qual == 0) abrirInicio(null);
                else if (qual == 1) finish();
            })
            .show();
    }

    private class Cliente extends WebViewClient {
        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap icone) {
            urlAtual = url;
        }

        // Links para outros sites abrem no navegador; o Operatto continua no app.
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest pedido) {
            Uri destino = pedido.getUrl();
            String servidor = prefs.getString("servidor", "");
            String url = destino.toString();
            if (url.startsWith("file:///android_asset/") || (!servidor.isEmpty() && url.startsWith(servidor))) return false;
            startActivity(new Intent(Intent.ACTION_VIEW, destino));
            return true;
        }

        // O caixa principal não respondeu: volta para a tela de conexão, que tenta de novo.
        @Override
        public void onReceivedError(WebView view, WebResourceRequest pedido, WebResourceError erro) {
            if (pedido.isForMainFrame() && !pedido.getUrl().toString().startsWith("file:")) {
                abrirInicio("sem-conexao");
            }
        }
    }

    /** Funções que a tela de conexão (somente ela) pode chamar. */
    private class Ponte {
        @JavascriptInterface
        public String servidorAtual() {
            if (!naTelaInicio()) return "";
            return prefs.getString("servidor", "");
        }

        @JavascriptInterface
        public void abrir(String endereco) {
            if (!naTelaInicio() || endereco == null || !endereco.matches("^https?://[^\\s/]+(:\\d+)?$")) return;
            prefs.edit().putString("servidor", endereco).apply();
            runOnUiThread(() -> web.loadUrl(endereco + "/"));
        }

        @JavascriptInterface
        public void esquecer() {
            if (!naTelaInicio()) return;
            prefs.edit().remove("servidor").apply();
        }

        @JavascriptInterface
        public boolean telaLigada() {
            return prefs.getBoolean("telaLigada", false);
        }

        @JavascriptInterface
        public void definirTelaLigada(boolean ligada) {
            if (!naTelaInicio()) return;
            prefs.edit().putBoolean("telaLigada", ligada).apply();
            runOnUiThread(MainActivity.this::aplicarTelaLigada);
        }

        @JavascriptInterface
        public String ipLocal() {
            try {
                for (NetworkInterface rede : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                    if (!rede.isUp() || rede.isLoopback()) continue;
                    for (InetAddress ip : Collections.list(rede.getInetAddresses())) {
                        if (ip instanceof Inet4Address && !ip.isLoopbackAddress()) return ip.getHostAddress();
                    }
                }
            } catch (Exception ignorado) { }
            return "";
        }

        /** Pergunta "OPERATTO?" na rede (como os computadores) e devolve os caixas que responderem. */
        @JavascriptInterface
        public String procurar() {
            if (!naTelaInicio()) return "[]";
            Map<String, JSONObject> encontrados = new LinkedHashMap<>();
            WifiManager wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            WifiManager.MulticastLock trava = wifi != null ? wifi.createMulticastLock("operatto") : null;
            try (DatagramSocket socket = new DatagramSocket()) {
                if (trava != null) trava.acquire();
                socket.setBroadcast(true);
                socket.setSoTimeout(400);
                byte[] pergunta = "OPERATTO?".getBytes("UTF-8");
                for (InetAddress destino : enderecosBroadcast()) {
                    socket.send(new DatagramPacket(pergunta, pergunta.length, destino, PORTA_DESCOBERTA));
                }
                long fim = System.currentTimeMillis() + 1800;
                byte[] buffer = new byte[2048];
                while (System.currentTimeMillis() < fim) {
                    DatagramPacket resposta = new DatagramPacket(buffer, buffer.length);
                    try {
                        socket.receive(resposta);
                    } catch (SocketTimeoutException tempo) {
                        continue;
                    }
                    try {
                        JSONObject dados = new JSONObject(new String(resposta.getData(), 0, resposta.getLength(), "UTF-8"));
                        if (!dados.optBoolean("operatto")) continue;
                        String ip = resposta.getAddress().getHostAddress();
                        JSONObject item = new JSONObject();
                        item.put("nome", dados.optString("nome", "Operatto"));
                        item.put("endereco", "http://" + ip + ":" + dados.optInt("porta", 8787));
                        encontrados.put(ip, item);
                    } catch (Exception respostaInvalida) { }
                }
            } catch (Exception erro) {
                // sem rede: a tela de conexão tenta a varredura alternativa
            } finally {
                if (trava != null && trava.isHeld()) trava.release();
            }
            return new JSONArray(encontrados.values()).toString();
        }

        private java.util.List<InetAddress> enderecosBroadcast() throws Exception {
            java.util.List<InetAddress> lista = new java.util.ArrayList<>();
            lista.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface rede : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!rede.isUp() || rede.isLoopback()) continue;
                for (InterfaceAddress endereco : rede.getInterfaceAddresses()) {
                    if (endereco.getBroadcast() != null) lista.add(endereco.getBroadcast());
                }
            }
            return lista;
        }
    }
}

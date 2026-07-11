/**
 * GeradorQR.gs — Gera QR Codes dos participantes (planilha PARTICIPANTES_unificado)
 * e sincroniza o qr_url no Supabase, no formato que o EnviarQR.gs e a
 * inscricao.html já esperam (contém "fid=<fileId>").
 *
 * PROJETO SEPARADO: este arquivo é autossuficiente (tem seu próprio CONFIG e
 * helpers de Supabase). Se você colar isto no MESMO projeto do Code.gs, vai dar
 * conflito de "CONFIG"/"onOpen" já declarados — mantenha em um projeto próprio.
 *
 * PRÉ-REQUISITO: em Project Settings → Script Properties, criar
 *   SUPABASE_SERVICE_KEY = (a service_role do Supabase).  NUNCA no front.
 */

const CONFIG = {
  PLANILHA_ID:       "1cMYIDoAaWsL4v9bO9kh_jeBA3YC5peDuZsKX0EN7VRE",
  ABA_PARTICIPANTES: "PARTICIPANTES_unificado",
  PASTA_RAIZ_ID:     "1l3cmHgWyi_13YXhcXenYJg4lUDP7JMsL",

  // Confirme escaneando 1 QR qual URL realmente abre o site publicado.
  URL_VALIDACAO:     "https://smedigital.com.br/congresso/validar.html",

  // Supabase (mesmo projeto do gom; schema da presença)
  SUPABASE_URL:      "https://iqldovwttomkjkoakosc.supabase.co",
  SUPABASE_SCHEMA:   "presenca",

  COL_TOKEN:    1,   // A
  COL_NOME:     2,   // B
  COL_EMAIL:    3,   // C
  COL_PALESTRA: 5,   // E  (PALESTRA_ID)

  COL_LINK:     17,  // Q  (URL do arquivo no Drive)
  COL_FILEID:   18   // R  (fileId)
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("QR Codes")
    .addItem("Gerar somente novos", "gerarQRCodes")
    .addItem("Regenerar todos",     "regenerarTodosQRCodes")
    .addSeparator()
    .addItem("Limpar links",             "limparQRCodes")
    .addItem("Apagar arquivos do Drive", "apagarTodosQRCodes")
    .addToUi();
}

// ── GERAÇÃO ───────────────────────────────────────────────────
function gerarQRCodes() {
  const ss  = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  const aba = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  if (!aba) throw new Error("Aba não encontrada: " + CONFIG.ABA_PARTICIPANTES);

  const dados     = aba.getDataRange().getValues();
  const pastaRaiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ_ID);
  const cache     = {};
  const links     = [];
  const ids       = [];

  let gerados = 0, ignorados = 0, erros = 0, errosSupa = 0;

  for (let i = 1; i < dados.length; i++) {
    const linha    = dados[i];
    const token    = String(linha[CONFIG.COL_TOKEN - 1]    || "").trim();
    const nome     = String(linha[CONFIG.COL_NOME - 1]     || "").trim();
    const palestra = String(linha[CONFIG.COL_PALESTRA - 1] || "").trim();
    const atual    = linha[CONFIG.COL_LINK - 1];

    // Sem token, ou já tem link -> mantém e pula (modo "somente novos")
    if (!token || atual) {
      links.push([atual || ""]);
      ids.push([linha[CONFIG.COL_FILEID - 1] || ""]);
      ignorados++;
      continue;
    }

    try {
      const pasta   = obterPasta(pastaRaiz, palestra, cache);
      const destino = CONFIG.URL_VALIDACAO + "?t=" + encodeURIComponent(token);
      const qr      = "https://quickchart.io/qr?size=600&margin=1&ecLevel=M&text=" +
                      encodeURIComponent(destino);

      const blob = UrlFetchApp.fetch(qr).getBlob()
        .setName(token + "_" + nome.replace(/[\\\/:*?"<>|]/g, "_") + ".png");

      const arq = pasta.createFile(blob);
      arq.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

      const fileId = arq.getId();
      links.push([arq.getUrl()]);
      ids.push([fileId]);

      // Sincroniza no Supabase: qr_url contém "fid=<fileId>" (formato esperado
      // por EnviarQR.gs e inscricao.html para extrair o fileId).
      const qrUrlSupa = CONFIG.URL_VALIDACAO +
                        "?t="   + encodeURIComponent(token) +
                        "&fid=" + encodeURIComponent(fileId);
      try {
        _supaPatchQR(token, qrUrlSupa);
      } catch (eSupa) {
        Logger.log("Supabase " + token + ": " + eSupa);
        errosSupa++;
      }

      gerados++;
      if (gerados % 100 === 0) Logger.log("QR gerados: " + gerados);

    } catch (err) {
      Logger.log(token + ": " + err);
      links.push([""]);
      ids.push([""]);
      erros++;
    }
  }

  if (dados.length > 1) {
    aba.getRange(2, CONFIG.COL_LINK,   links.length, 1).setValues(links);
    aba.getRange(2, CONFIG.COL_FILEID, ids.length,   1).setValues(ids);
  }

  SpreadsheetApp.getUi().alert(
    "Concluído!\n\n" +
    "Gerados: "        + gerados   + "\n" +
    "Ignorados: "      + ignorados + "\n" +
    "Erros (QR): "     + erros     + "\n" +
    "Erros (Supabase): " + errosSupa
  );
}

function regenerarTodosQRCodes() {
  limparQRCodes();
  gerarQRCodes();
}

// ── SUPABASE ──────────────────────────────────────────────────
function _supaKey() {
  const k = PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_KEY");
  if (!k) throw new Error("SUPABASE_SERVICE_KEY não configurada em Script Properties.");
  return k;
}

function _supaPatchQR(token, qrUrl) {
  const key = _supaKey();
  const url = CONFIG.SUPABASE_URL + "/rest/v1/participantes?token=eq." + encodeURIComponent(token);
  const res = UrlFetchApp.fetch(url, {
    method:      "patch",
    contentType: "application/json",
    headers: {
      "apikey":          key,
      "Authorization":   "Bearer " + key,
      "Accept-Profile":  CONFIG.SUPABASE_SCHEMA,
      "Content-Profile": CONFIG.SUPABASE_SCHEMA,
      "Prefer":          "return=minimal"
    },
    payload:            JSON.stringify({ qr_url: qrUrl }),
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code >= 400) throw new Error("PATCH " + code + " " + res.getContentText());
}

// ── DRIVE / LIMPEZA ───────────────────────────────────────────
function obterPasta(raiz, nome, cache) {
  nome = (nome || "SEM_PALESTRA").replace(/[\\\/:*?"<>|]/g, "_");
  if (cache[nome]) return cache[nome];
  const it    = raiz.getFoldersByName(nome);
  const pasta = it.hasNext() ? it.next() : raiz.createFolder(nome);
  cache[nome] = pasta;
  return pasta;
}

function limparQRCodes() {
  const aba = SpreadsheetApp.openById(CONFIG.PLANILHA_ID).getSheetByName(CONFIG.ABA_PARTICIPANTES);
  const ult = aba.getLastRow();
  if (ult > 1) aba.getRange(2, CONFIG.COL_LINK, ult - 1, 2).clearContent();
}

function apagarTodosQRCodes() {
  const raiz = DriveApp.getFolderById(CONFIG.PASTA_RAIZ_ID);
  apagarRecursivo(raiz);
  limparQRCodes();
}

function apagarRecursivo(pasta) {
  const arquivos = pasta.getFiles();
  while (arquivos.hasNext()) arquivos.next().setTrashed(true);

  const subs = pasta.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    apagarRecursivo(sub);
    sub.setTrashed(true);
  }
}

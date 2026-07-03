/**
 * GERARQR.GS
 * Geração de QR Codes e sincronização incremental com o Supabase.
 *
 * NÃO define URL/chave/cliente do Supabase aqui — reaproveita o supaFetch,
 * SUPABASE_URL e SUPABASE_SCHEMA definidos no Code.gs (mesmo projeto Apps Script).
 * Assim há UMA única configuração de Supabase, sem conflito entre arquivos.
 */

var PASTA_RAIZ_ID = "1l3cmHgWyi_13YXhcXenYJg4lUDP7JMsL";
var SITE_BASE_URL = "https://smedigital.com.br/validar.html";


// ── SINCRONIZAR NOVOS INSCRITOS ───────────────────────────────
// Lê a planilha e insere no Supabase APENAS os registros que ainda
// não existem (baseado no token). Não toca em quem já está lá.
// Também gera QR Code para os novos.
function sincronizarNovosInscritos() {

  var ui  = SpreadsheetApp.getUi();
  var ss  = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);

  // 1. Busca tokens que já existem no Supabase
  var existentes = supaFetch("participantes?select=token", "GET", null);
  var tokensExistentes = {};
  if (Array.isArray(existentes)) {
    existentes.forEach(function(p) {
      tokensExistentes[String(p.token)] = true;
    });
  }

  // 2. Busca palestras já existentes no Supabase
  var palestrasExistentes = supaFetch("palestras?select=id", "GET", null);
  var idsExistentes = {};
  if (Array.isArray(palestrasExistentes)) {
    palestrasExistentes.forEach(function(p) { idsExistentes[String(p.id)] = true; });
  }

  // 3. Lê palestras da planilha e insere as novas
  var abaPalestras  = ss.getSheetByName(CONFIG.ABA_PALESTRAS);
  var rowsPalestras = abaPalestras.getDataRange().getValues();
  var mapPalestras  = {};
  for (var i = 1; i < rowsPalestras.length; i++) {
    var pid = String(rowsPalestras[i][0]);
    mapPalestras[pid] = rowsPalestras[i][1];
    if (!pid || idsExistentes[pid]) continue;
    supaFetch("palestras?on_conflict=id", "POST", {
      id:            pid,
      nome:          rowsPalestras[i][1],
      carga_horaria: String(rowsPalestras[i][2] || "")
    });
  }

  // 4. Lê participantes e processa apenas os novos
  var abaPartic = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  var dados     = abaPartic.getDataRange().getValues();
  var pastaRaiz = DriveApp.getFolderById(PASTA_RAIZ_ID);
  var mapPastas = {};

  var inseridos   = 0;
  var ignorados   = 0;
  var errosInsert = 0;
  var qrGerados   = 0;
  var errosQR     = 0;

  for (var i = 1; i < dados.length; i++) {

    var token      = String(dados[i][0]).trim();
    var nome       = String(dados[i][1]).trim();
    var email      = String(dados[i][2]).trim();
    var cpf        = String(dados[i][3]).replace(/\D/g, "");
    var palestraId = String(dados[i][4]).trim();
    var qrAtual    = dados[i][5];

    if (!token) { ignorados++; continue; }

    // Já existe no Supabase — pula inserção mas verifica QR
    if (tokensExistentes[token]) {

      // Gera QR se ainda não tem
      if (!qrAtual || String(qrAtual).trim() === "") {
        try {
          var linkHtml = gerarQRNoDrive(
            token, nome, palestraId,
            mapPalestras[palestraId] || "",
            pastaRaiz, mapPastas
          );
          abaPartic.getRange(i + 1, 6).setValue(linkHtml);
          supaFetch(
            "participantes?token=eq." + encodeURIComponent(token),
            "PATCH",
            { qr_url: linkHtml }
          );
          qrGerados++;
        } catch(e) {
          Logger.log("Erro QR token " + token + ": " + e.message);
          errosQR++;
        }
      } else {
        ignorados++;
      }
      continue;
    }

    // Novo participante — insere no Supabase
    try {
      supaFetch("participantes?on_conflict=token", "POST", {
        token:       token,
        nome:        nome,
        email:       email,
        cpf:         cpf,
        palestra_id: palestraId,
        qr_url:      ""
      });
      inseridos++;
    } catch(e) {
      Logger.log("Erro insert token " + token + ": " + e.message);
      errosInsert++;
      continue;
    }

    // Gera QR para o novo participante
    try {
      var linkHtml = gerarQRNoDrive(
        token, nome, palestraId,
        mapPalestras[palestraId] || "",
        pastaRaiz, mapPastas
      );
      abaPartic.getRange(i + 1, 6).setValue(linkHtml);
      supaFetch(
        "participantes?token=eq." + encodeURIComponent(token),
        "PATCH",
        { qr_url: linkHtml }
      );
      qrGerados++;
    } catch(e) {
      Logger.log("Erro QR token " + token + ": " + e.message);
      errosQR++;
    }

  }

  ui.alert(
    "Sincronizacao concluida!\n\n" +
    "Novos inscritos:  " + inseridos   + "\n" +
    "QR Codes gerados: " + qrGerados   + "\n" +
    "Ignorados:        " + ignorados   + "\n" +
    "Erros insert:     " + errosInsert + "\n" +
    "Erros QR:         " + errosQR
  );

}


// ── GERAR QR CODES (apenas novos) ────────────────────────────
// Gera QR somente para participantes sem QR na planilha.
function gerarQRCodes() {

  var ss           = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  var abaPartic    = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  var abaPalestras = ss.getSheetByName(CONFIG.ABA_PALESTRAS);
  var dados        = abaPartic.getDataRange().getValues();
  var pastaRaiz    = DriveApp.getFolderById(PASTA_RAIZ_ID);

  var mapPalestras = {};
  var rowsPal = abaPalestras.getDataRange().getValues();
  for (var i = 1; i < rowsPal.length; i++) {
    mapPalestras[String(rowsPal[i][0])] = rowsPal[i][1];
  }

  var mapPastas   = {};
  var atualizados = 0;
  var ignorados   = 0;
  var erros       = 0;

  for (var i = 1; i < dados.length; i++) {

    var token      = String(dados[i][0]).trim();
    var nome       = String(dados[i][1]).trim();
    var palestraId = String(dados[i][4]).trim();
    var qrAtual    = dados[i][5];

    if (!token)                            { ignorados++; continue; }
    if (qrAtual && String(qrAtual).trim()) { ignorados++; continue; }

    try {
      var linkHtml = gerarQRNoDrive(
        token, nome, palestraId,
        mapPalestras[palestraId] || "",
        pastaRaiz, mapPastas
      );
      abaPartic.getRange(i + 1, 6).setValue(linkHtml);
      supaFetch(
        "participantes?token=eq." + encodeURIComponent(token),
        "PATCH",
        { qr_url: linkHtml }
      );
      atualizados++;
    } catch(e) {
      Logger.log("Erro token " + token + ": " + e.message);
      erros++;
    }

  }

  SpreadsheetApp.getUi().alert(
    "QR Codes gerados!\n\n" +
    "Gerados: "   + atualizados + "\n" +
    "Ignorados: " + ignorados   + "\n" +
    "Erros: "     + erros
  );

}


// ── REGENERAR TODOS OS QR CODES ───────────────────────────────
function regenerarTodosQRCodes() {

  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    "Atencao",
    "Isso vai apagar e recriar TODOS os QR Codes.\nContinuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  // Limpa coluna F da planilha
  var ss     = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  var aba    = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  var ultima = aba.getLastRow();
  if (ultima > 1) aba.getRange(2, 6, ultima - 1, 1).clearContent();

  // Limpa qr_url no Supabase
  supaFetch("participantes?qr_url=neq.''", "PATCH", { qr_url: "" });

  // Apaga subpastas do Drive
  var pastas = DriveApp.getFolderById(PASTA_RAIZ_ID).getFolders();
  while (pastas.hasNext()) pastas.next().setTrashed(true);

  gerarQRCodes();

}


// ── HELPER: GERA QR NO DRIVE ─────────────────────────────────
function gerarQRNoDrive(token, nome, palestraId, palestraNome, pastaRaiz, mapPastas) {

  var nomePastaSeguro = (palestraNome || "Sem_Palestra").replace(/[\/\\:*?"<>|]/g, "_");

  if (!mapPastas[palestraId]) {
    mapPastas[palestraId] = obterOuCriarPasta(pastaRaiz, nomePastaSeguro);
  }
  var subpasta = mapPastas[palestraId];

  // QR aponta para o site de validação
  var urlValidar =
    SITE_BASE_URL + "?t=" + encodeURIComponent(token);

  var urlQRImg =
    "https://quickchart.io/qr" +
    "?text=" + encodeURIComponent(urlValidar) +
    "&size=400&margin=2&ecLevel=M";

  var blob = UrlFetchApp.fetch(urlQRImg).getBlob();
  var nomeArq = token + "_" + nome.replace(/[\/\\:*?"<>|]/g, "_") + ".png";
  blob.setName(nomeArq);

  var arquivo = subpasta.createFile(blob);
  arquivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  var fileId = arquivo.getId();
  var urlBase = ScriptApp.getService().getUrl();

  return urlBase +
    "?action=verQR" +
    "&t=" + encodeURIComponent(token) +
    "&n=" + encodeURIComponent(nome) +
    "&p=" + encodeURIComponent(palestraNome) +
    "&fid=" + encodeURIComponent(fileId);

}


// ── HELPER ────────────────────────────────────────────────────
function obterOuCriarPasta(pai, nome) {
  var iter = pai.getFoldersByName(nome);
  if (iter.hasNext()) return iter.next();
  return pai.createFolder(nome);
}


// ── SINCRONIZAR ALTERAÇÕES DA PLANILHA → SUPABASE ─────────────
// Varre todos os participantes e atualiza no Supabase
// quem tiver nome, email, cpf ou palestra diferente.
// Configurar gatilho: Eventos → Configurar sync automatico (15 min)
function sincronizarAlteracoesInscritos() {

  var ss       = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  var aba      = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  var dados    = aba.getDataRange().getValues();

  // Busca todos os participantes do Supabase de uma vez
  var existentes = supaFetch(
    "participantes?select=token,nome,email,cpf,palestra_id",
    "GET", null
  );

  if (!Array.isArray(existentes)) {
    Logger.log("Erro ao buscar participantes do Supabase.");
    return;
  }

  // Monta mapa token -> dados atuais no Supabase
  var mapSupa = {};
  existentes.forEach(function(p) { mapSupa[p.token] = p; });

  var atualizados = 0;
  var ignorados   = 0;
  var erros       = 0;

  for (var i = 1; i < dados.length; i++) {

    var token      = String(dados[i][0]).trim();
    var nome       = String(dados[i][1]).trim();
    var email      = String(dados[i][2]).trim().toLowerCase();
    var cpf        = String(dados[i][3]).replace(/\D/g, "");
    var palestraId = String(dados[i][4]).trim();

    if (!token) { ignorados++; continue; }

    var atual = mapSupa[token];

    // Token nao existe no Supabase — pula (use sincronizarNovosInscritos)
    if (!atual) { ignorados++; continue; }

    // Verifica se algo mudou
    var mudou =
      atual.nome        !== nome       ||
      atual.email       !== email      ||
      atual.cpf         !== cpf        ||
      String(atual.palestra_id) !== palestraId;

    if (!mudou) { ignorados++; continue; }

    // Atualiza no Supabase
    var res = supaFetch(
      "participantes?token=eq." + encodeURIComponent(token),
      "PATCH",
      { nome: nome, email: email, cpf: cpf, palestra_id: palestraId }
    );

    if (res && res.error) {
      Logger.log("Erro ao atualizar token " + token + ": " + JSON.stringify(res));
      erros++;
    } else {
      Logger.log("Atualizado: " + token + " | " + nome);
      atualizados++;
    }

  }

  Logger.log(
    "Sync concluido. Atualizados: " + atualizados +
    " | Ignorados: " + ignorados +
    " | Erros: " + erros
  );

}


// ── CONFIGURAR GATILHO AUTOMATICO (15 MIN) ────────────────────
function configurarSyncInscritos() {

  // Remove gatilhos existentes para evitar duplicata
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "sincronizarAlteracoesInscritos") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("sincronizarAlteracoesInscritos")
    .timeBased()
    .everyMinutes(15)
    .create();

  SpreadsheetApp.getUi().alert(
    "Gatilho configurado!\n\nAlteracoes na planilha serao sincronizadas com o Supabase a cada 15 minutos."
  );

}

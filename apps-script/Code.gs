/**
 * CODE.GS
 * Responsabilidades:
 *   1. Roteador do Web App (?action=verQR)
 *   2. Migrar dados da planilha para o Supabase (uma vez)
 *   3. Sincronizar presencas do Supabase para a planilha
 *   4. Envio de emails de confirmacao de presenca
 *
 * Geracao de QR Codes e sincronizacao incremental -> GerarQR.gs
 * Frontend (smedigital.com.br) faz tudo direto no Supabase.
 *
 * SEGURANCA (ver SECURITY.md na raiz do repo):
 *   - A chave do Supabase vem de Script Properties (SUPABASE_SERVICE_KEY),
 *     e deve ser a service_role (roda no servidor, nunca exposta ao navegador).
 *   - As acoes do gerente (syncInscritos / enviarEmails) exigem que o e-mail
 *     do chamador seja um gerente cadastrado em validadores.
 */

var SUPABASE_URL = "https://kormvmwdkyssxhdkgthd.supabase.co";

// A chave fica em Project Settings -> Script Properties (chave: SUPABASE_SERVICE_KEY).
// Use a service_role do Supabase (Settings -> API). NUNCA cole a service_role no front.
function supaKey() {
  var k = PropertiesService.getScriptProperties().getProperty("SUPABASE_SERVICE_KEY");
  if (!k) throw new Error("SUPABASE_SERVICE_KEY nao configurada em Script Properties.");
  return k;
}


// ── ESCAPE HTML (previne XSS) ─────────────────────────────────
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}


// ── ROTEADOR ──────────────────────────────────────────────────
function doGet(e) {

  var p      = (e && e.parameter) ? e.parameter : {};
  var action = p.action || "";

  // Rota publica: pagina do QR Code (link enviado ao participante)
  if (action === "verQR") {
    var token    = p.t   || "";
    var nome     = p.n   || "Participante";
    var palestra = p.p   || "";
    var fileId   = p.fid || "";
    return renderizarPaginaQR(token, nome, palestra, fileId);
  }

  // Rotas sensiveis (dashboard do gerente): exigem gerente autorizado
  if (action === "syncInscritos" || action === "enviarEmails") {
    if (!gerenteAutorizado(p.email)) {
      return json({ ok: false, mensagem: "nao autorizado" });
    }
    try {
      if (action === "syncInscritos") {
        sincronizarAlteracoesInscritos();
        return json({ ok: true, mensagem: "Inscritos sincronizados com sucesso." });
      }
      enviarEmailsConfirmacao();
      return json({ ok: true, mensagem: "Emails pendentes enviados." });
    } catch (err) {
      return json({ ok: false, mensagem: "Erro: " + err.message });
    }
  }

  return ContentService
    .createTextOutput("Apps Script ativo.")
    .setMimeType(ContentService.MimeType.TEXT);

}


// ── AUTORIZACAO ───────────────────────────────────────────────
// Confere se o e-mail informado e um gerente cadastrado em validadores.
// Usa a service_role, entao funciona mesmo com RLS fechado para anon.
function gerenteAutorizado(email) {
  if (!email) return false;
  var r = supaFetch(
    "validadores?email=eq." + encodeURIComponent(email) +
    "&perfil=eq.gerente&select=email&limit=1",
    "GET", null
  );
  return Array.isArray(r) && r.length > 0;
}


// ── HELPER JSON ──────────────────────────────────────────────
function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ── HELPER SUPABASE ───────────────────────────────────────────
function supaFetch(path, method, body) {

  var key = supaKey();

  // Prefer: para POST devolve a representação; se a URL usa on_conflict,
  // ativa o upsert real (senão o PostgREST retorna 409 em conflito).
  var prefer = "";
  if (method === "POST") {
    prefer = "return=representation";
    if (path.indexOf("on_conflict") !== -1) prefer += ",resolution=merge-duplicates";
  }

  var options = {
    method:  method || "GET",
    headers: {
      "apikey":        key,
      "Authorization": "Bearer " + key,
      "Content-Type":  "application/json",
      "Prefer":        prefer
    },
    muteHttpExceptions: true
  };

  if (body) options.payload = JSON.stringify(body);

  var response = UrlFetchApp.fetch(SUPABASE_URL + "/rest/v1/" + path, options);
  var code = response.getResponseCode();
  var text = response.getContentText();
  var data = (text && text.trim() !== "") ? JSON.parse(text) : {};

  // Erro real do PostgREST: devolve { error } para os chamadores detectarem
  // (antes, o erro vinha como {code,message} e o "if (res.error)" nunca pegava).
  if (code >= 400) {
    Logger.log("supaFetch " + method + " " + path + " -> " + code + " " + text);
    return { error: data, status: code };
  }
  return data;

}


// ── MIGRAR PLANILHA → SUPABASE ────────────────────────────────
// Rodar UMA VEZ por evento. Migra palestras, participantes e presencas.
// Validadores gerenciados pela tela fiscais.html — nao migrar aqui.
function migrarParaSupabase() {

  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    "Migrar dados",
    "Isso vai copiar todos os dados da planilha para o Supabase.\n\nContinuar?",
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  var ss = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);

  // 1. Palestras
  var rowsPal  = ss.getSheetByName(CONFIG.ABA_PALESTRAS).getDataRange().getValues();
  var errosPal = 0;
  for (var i = 1; i < rowsPal.length; i++) {
    var r = rowsPal[i];
    if (!r[0]) continue;
    var res = supaFetch(
      "palestras?on_conflict=id",
      "POST",
      { id: String(r[0]), nome: String(r[1]), carga_horaria: String(r[2] || "") }
    );
    if (res.error) { Logger.log("Palestra erro: " + JSON.stringify(res)); errosPal++; }
  }

  // 2. Participantes
  var rowsPart  = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES).getDataRange().getValues();
  var errosPart = 0;
  for (var i = 1; i < rowsPart.length; i++) {
    var r = rowsPart[i];
    if (!r[0]) continue;
    var res = supaFetch(
      "participantes?on_conflict=token",
      "POST",
      {
        token:       String(r[0]),
        nome:        String(r[1]),
        email:       String(r[2]),
        cpf:         String(r[3]).replace(/\D/g, ""),
        palestra_id: String(r[4]),
        qr_url:      String(r[5] || "")
      }
    );
    if (res.error) { Logger.log("Participante erro: " + JSON.stringify(res)); errosPart++; }
  }

  // 3. Presencas (se houver registros anteriores)
  var rowsPres  = ss.getSheetByName(CONFIG.ABA_PRESENCAS).getDataRange().getValues();
  var errosPres = 0;
  for (var i = 1; i < rowsPres.length; i++) {
    var r = rowsPres[i];
    if (!r[0]) continue;
    var res = supaFetch(
      "presencas?on_conflict=token",
      "POST",
      {
        token:        String(r[0]),
        palestra_id:  String(r[1]),
        data_hora:    new Date(r[2]).toISOString(),
        validado_por: String(r[3] || "")
      }
    );
    if (res.error) { Logger.log("Presenca erro: " + JSON.stringify(res)); errosPres++; }
  }

  ui.alert(
    "Migracao concluida!\n\n" +
    "Palestras:     erros " + errosPal  + "\n" +
    "Participantes: erros " + errosPart + "\n" +
    "Presencas:     erros " + errosPres + "\n\n" +
    "Proximo passo: Eventos → Sincronizar novos inscritos + QR"
  );

}


// ── SINCRONIZAR PRESENCAS → PLANILHA ─────────────────────────
// Importa todas as presencas do Supabase para a aba PRESENCAS.
// Util para relatorios e analises na planilha.
function sincronizarPresencas() {

  try {

    var ss  = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
    var aba = ss.getSheetByName(CONFIG.ABA_PRESENCAS);

    var data = supaFetch(
      "presencas?select=token,palestra_id,data_hora,validado_por," +
      "participantes(nome,email),palestras(nome)&order=data_hora.asc",
      "GET", null
    );

    if (!Array.isArray(data)) {
      SpreadsheetApp.getUi().alert("Erro ao buscar presencas:\n" + JSON.stringify(data));
      return;
    }

    // Limpa mantendo cabecalho
    var ultimaLinha = aba.getLastRow();
    if (ultimaLinha > 1) {
      aba.getRange(2, 1, ultimaLinha - 1, aba.getLastColumn()).clearContent();
    }

    if (data.length === 0) {
      SpreadsheetApp.getUi().alert("Nenhuma presenca encontrada no Supabase.");
      return;
    }

    aba.getRange(1, 1, 1, 6).setValues([[
      "TOKEN", "PALESTRA_ID", "DATA_HORA", "VALIDADO_POR", "NOME_PARTICIPANTE", "NOME_PALESTRA"
    ]]);

    var linhas = data.map(function(p) {
      return [
        p.token        || "",
        p.palestra_id  || "",
        p.data_hora    ? new Date(p.data_hora) : "",
        p.validado_por || "",
        p.participantes ? p.participantes.nome  : "",
        p.palestras     ? p.palestras.nome      : ""
      ];
    });

    aba.getRange(2, 1, linhas.length, 6).setValues(linhas);
    aba.getRange(2, 3, linhas.length, 1).setNumberFormat("dd/mm/yyyy hh:mm:ss");

    SpreadsheetApp.getUi().alert(
      "Sincronizacao concluida!\n\n" +
      linhas.length + " presenca(s) importada(s)."
    );

  } catch (erro) {
    SpreadsheetApp.getUi().alert("Erro: " + erro.message);
  }

}


// ── ENVIAR EMAILS DE CONFIRMACAO ──────────────────────────────
// Busca presencas com email_enviado=false e envia via Gmail.
// Configurar gatilho de 1x/hora com: Eventos → Configurar envio automatico
function enviarEmailsConfirmacao() {

  try {

    var configResp = supaFetch("email_config?id=eq.1&select=*&limit=1", "GET", null);
    if (!Array.isArray(configResp) || configResp.length === 0) {
      Logger.log("Configuracao de email nao encontrada.");
      return;
    }
    var config = configResp[0];

    // Inclui email_enviado NULL além de false (caso a coluna não tenha
    // default false, presenças novas ficariam NULL e nunca receberiam e-mail).
    var presencas = supaFetch(
      "presencas?or=(email_enviado.is.null,email_enviado.eq.false)" +
      "&select=token,palestra_id,data_hora,validado_por," +
      "participantes(nome,email),palestras(nome)",
      "GET", null
    );

    if (!Array.isArray(presencas) || presencas.length === 0) {
      Logger.log("Nenhum email pendente.");
      return;
    }

    Logger.log("Enviando " + presencas.length + " email(s)...");

    var enviados = 0;
    var erros    = 0;

    presencas.forEach(function(pr) {
      try {

        var nome     = pr.participantes ? pr.participantes.nome  : "Participante";
        var email    = pr.participantes ? pr.participantes.email : null;
        var palestra = pr.palestras     ? pr.palestras.nome      : "";
        var dt       = pr.data_hora
          ? Utilities.formatDate(
              new Date(pr.data_hora),
              Session.getScriptTimeZone(),
              "dd/MM/yyyy 'as' HH:mm"
            )
          : "";

        if (!email) { erros++; return; }

        // Versoes escapadas para injecao segura no HTML do e-mail
        var nomeH     = esc(nome);
        var palestraH = esc(palestra);
        var tokenH    = esc(pr.token);

        var saudacao = (config.saudacao || "Ola, {nome}!")
          .replace(/{nome}/g, nomeH)
          .replace(/{palestra}/g, palestraH)
          .replace(/{token}/g, tokenH);

        var mensagem = (config.mensagem || "Sua presenca foi confirmada.")
          .replace(/{nome}/g, nomeH)
          .replace(/{palestra}/g, palestraH)
          .replace(/{token}/g, tokenH);

        var rodape = (config.rodape || "Obrigado!")
          .replace(/{nome}/g, nomeH);

        var nomeEvento  = esc(config.nome_evento || "Evento");
        var corPrimaria = config.cor_primaria || "#1976d2";

        var htmlBody =
          '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
          '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">' +
          '<div style="max-width:560px;margin:24px auto;padding:0 16px;">' +
            '<div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">' +
              '<div style="background:' + corPrimaria + ';padding:28px 32px;text-align:center;">' +
                '<h1 style="color:#fff;font-size:20px;margin:0;">' + nomeEvento + '</h1>' +
              '</div>' +
              '<div style="padding:28px 32px;">' +
                '<p style="font-size:16px;color:#1a1a1a;margin:0 0 16px;">' + saudacao + '</p>' +
                '<p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">' + mensagem + '</p>' +
                '<div style="background:#f9f9f9;border:1px solid #eee;border-radius:8px;padding:14px 18px;margin-bottom:20px;">' +
                  '<p style="margin:0 0 6px;font-size:13px;color:#888;">Detalhes</p>' +
                  '<p style="margin:0;font-size:14px;color:#333;"><strong>Palestra:</strong> ' + palestraH + '</p>' +
                  '<p style="margin:4px 0 0;font-size:14px;color:#333;"><strong>Data/hora:</strong> ' + esc(dt) + '</p>' +
                  '<p style="margin:4px 0 0;font-size:13px;color:#888;font-family:monospace;">' + tokenH + '</p>' +
                '</div>' +
              '</div>' +
              '<div style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;">' +
                '<p style="margin:0;font-size:13px;color:#888;">' + rodape + '</p>' +
              '</div>' +
            '</div>' +
          '</div></body></html>';

        GmailApp.sendEmail(email, "Presenca confirmada — " + (config.nome_evento || "Evento"), "", {
          htmlBody: htmlBody,
          name:     config.nome_evento || "Evento"
        });

        supaFetch(
          "presencas?token=eq." + encodeURIComponent(pr.token),
          "PATCH",
          { email_enviado: true }
        );

        enviados++;
        Logger.log("Email enviado: " + email);

      } catch(erroItem) {
        Logger.log("Erro token " + pr.token + ": " + erroItem.message);
        erros++;
      }
    });

    Logger.log("Concluido. Enviados: " + enviados + " | Erros: " + erros);

  } catch(erro) {
    Logger.log("Erro geral: " + erro.message);
  }

}


// ── CONFIGURAR GATILHO AUTOMATICO ─────────────────────────────
function configurarGatilhoEmail() {

  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "enviarEmailsConfirmacao") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("enviarEmailsConfirmacao")
    .timeBased()
    .everyHours(1)
    .create();

  SpreadsheetApp.getUi().alert(
    "Gatilho configurado!\n\nEmails enviados automaticamente a cada hora."
  );

}


// ── PAGINA HTML QR ────────────────────────────────────────────
function renderizarPaginaQR(token, nome, palestra, fileId) {

  var fid         = encodeURIComponent(fileId);
  var urlDownload = "https://drive.google.com/uc?export=download&id=" + fid;
  var urlImagem   = "https://lh3.googleusercontent.com/d/" + fid;

  var nomeH     = esc(nome);
  var palestraH = esc(palestra);
  var tokenH    = esc(token);

  var html =
    '<!DOCTYPE html><html lang="pt-BR"><head>' +
    '<meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>QR Code - ' + nomeH + '</title>' +
    '<style>' +
    'body{font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;display:flex;flex-direction:column;align-items:center;}' +
    '.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:100%;box-shadow:0 2px 16px rgba(0,0,0,.08);text-align:center;}' +
    'h1{font-size:20px;color:#1a1a1a;margin:0 0 4px;}' +
    '.sub{font-size:14px;color:#666;margin-bottom:20px;}' +
    '.token{font-family:monospace;font-size:13px;background:#f0f0f0;border-radius:6px;padding:4px 12px;color:#444;margin-bottom:20px;display:inline-block;}' +
    'img{width:100%;max-width:300px;border-radius:12px;border:1px solid #eee;}' +
    '.btn{margin-top:20px;display:block;background:#1976d2;color:#fff;text-decoration:none;padding:14px;border-radius:10px;font-size:15px;font-weight:bold;}' +
    '</style></head><body>' +
    '<div class="card">' +
    '<h1>' + nomeH + '</h1>' +
    '<div class="sub">' + palestraH + '</div>' +
    '<div class="token">' + tokenH + '</div>' +
    '<img src="' + urlImagem + '" alt="QR Code">' +
    '<a class="btn" href="' + urlDownload + '">Baixar QR Code</a>' +
    '</div></body></html>';

  return HtmlService
    .createHtmlOutput(html)
    .setTitle("QR Code - " + nomeH);

}


// ── DIAGNOSTICO ───────────────────────────────────────────────
function testarSupabase() {

  var res = supaFetch(
    "palestras?on_conflict=id", "POST",
    { id: "TESTE001", nome: "Palestra Teste", carga_horaria: "2h" }
  );
  Logger.log("INSERT: " + JSON.stringify(res));

  supaFetch("palestras?id=eq.TESTE001", "DELETE", null);

  SpreadsheetApp.getUi().alert("Resultado:\n\n" + JSON.stringify(res));

}


// ── MENU ─────────────────────────────────────────────────────
function onOpen() {

  SpreadsheetApp.getUi()
    .createMenu("Eventos")

    .addItem("1. Migrar planilha para Supabase", "migrarParaSupabase")

    .addSeparator()
    .addItem("2. Sincronizar novos inscritos + QR", "sincronizarNovosInscritos")
    .addItem("Gerar QR Codes (apenas sem QR)",      "gerarQRCodes")
    .addItem("Regenerar todos os QR Codes",          "regenerarTodosQRCodes")

    .addSeparator()
    .addItem("Sincronizar alteracoes de inscritos", "sincronizarAlteracoesInscritos")
    .addItem("Configurar sync automatico (15 min)", "configurarSyncInscritos")

    .addSeparator()
    .addItem("Sincronizar presencas do Supabase", "sincronizarPresencas")

    .addSeparator()
    .addItem("Enviar emails pendentes agora",           "enviarEmailsConfirmacao")
    .addItem("Configurar envio automatico (1x/hora)",  "configurarGatilhoEmail")

    .addToUi();

}

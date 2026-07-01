/**
 * EnviarQR.gs — Envia por e-mail o QR Code de acesso ao participante.
 * Arquivo separado do Code.gs para facilitar a manutenção. Reaproveita os
 * helpers GLOBAIS do Code.gs (supaFetch, esc) — ambos no mesmo projeto Apps Script.
 *
 * PRÉ-REQUISITOS
 *   1. Coluna booleana `qr_enviado` na tabela participantes:
 *        alter table participantes add column qr_enviado boolean not null default false;
 *   2. SUPABASE_SERVICE_KEY em Script Properties (a mesma usada pelo Code.gs).
 *   3. QR Codes já gerados (coluna qr_url preenchida) — menu Eventos.
 *
 * USO
 *   - Manual: menu Eventos → "Enviar QR Codes pendentes" (enviarQRCodesPendentes)
 *   - Auto:   menu Eventos → "Configurar envio de QR (1x/hora)" (configurarGatilhoQR)
 *   - Teste:  rodar enviarQRParaToken("EVT000001") no editor
 *
 * OBS: envia só para quem tem QR e ainda não recebeu (qr_enviado != true),
 * marcando qr_enviado=true após o envio — então rodar de novo não duplica.
 */

var QR_ASSUNTO = "Seu QR Code de acesso";

// Envia o QR de todos os participantes pendentes (com QR e ainda não enviados).
function enviarQRCodesPendentes() {
  try {
    var cfg = _qrConfigEmail();

    var lista = supaFetch(
      "participantes?or=(qr_enviado.is.null,qr_enviado.eq.false)&qr_url=not.is.null" +
      "&select=token,nome,email,qr_url,palestras(nome)",
      "GET", null
    );

    if (lista && lista.error) { Logger.log("Erro ao buscar pendentes: " + JSON.stringify(lista)); return; }
    if (!Array.isArray(lista) || lista.length === 0) { Logger.log("Nenhum QR pendente."); return; }

    Logger.log("Enviando " + lista.length + " QR Code(s)...");
    var enviados = 0, erros = 0, semQR = 0;

    lista.forEach(function(p) {
      try {
        if (!p.email) { erros++; return; }
        var fileId = _extrairFileId(p.qr_url);
        if (!fileId) { semQR++; return; }   // qr_url sem fid (QR ainda em preparo)

        _enviarQR(p, fileId, cfg);
        supaFetch("participantes?token=eq." + encodeURIComponent(p.token), "PATCH", { qr_enviado: true });
        enviados++;
        Logger.log("QR enviado: " + p.email);
      } catch (e) {
        erros++;
        Logger.log("Erro token " + p.token + ": " + e.message);
      }
    });

    Logger.log("Concluido. Enviados: " + enviados + " | Sem QR: " + semQR + " | Erros: " + erros);
  } catch (e) {
    Logger.log("Erro geral (QR): " + e.message);
  }
}

// Envia o QR de um token específico (teste/reenvio pontual).
function enviarQRParaToken(token) {
  var lista = supaFetch(
    "participantes?token=eq." + encodeURIComponent(token) +
    "&select=token,nome,email,qr_url,palestras(nome)&limit=1",
    "GET", null
  );
  if (!Array.isArray(lista) || lista.length === 0) { Logger.log("Token nao encontrado."); return; }

  var p = lista[0];
  if (!p.email) { Logger.log("Participante sem e-mail."); return; }
  var fileId = _extrairFileId(p.qr_url);
  if (!fileId) { Logger.log("Participante sem QR (qr_url sem fid)."); return; }

  _enviarQR(p, fileId, _qrConfigEmail());
  supaFetch("participantes?token=eq." + encodeURIComponent(p.token), "PATCH", { qr_enviado: true });
  Logger.log("QR enviado: " + p.email);
}

// Gatilho automático: envia QR pendentes a cada hora.
function configurarGatilhoQR() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "enviarQRCodesPendentes") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("enviarQRCodesPendentes").timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert("Gatilho configurado!\n\nQR Codes pendentes serao enviados a cada hora.");
}

// ── INTERNOS ─────────────────────────────────────────────────
function _qrConfigEmail() {
  var c = supaFetch("email_config?id=eq.1&select=*&limit=1", "GET", null);
  c = (Array.isArray(c) && c.length) ? c[0] : {};
  return {
    nomeEvento: c.nome_evento  || "Evento",
    cor:        c.cor_primaria || "#1976d2",
    rodape:     c.rodape       || "Guarde este e-mail e apresente o QR Code na entrada."
  };
}

function _extrairFileId(qrUrl) {
  if (!qrUrl) return "";
  var m = String(qrUrl).match(/fid=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

function _enviarQR(p, fileId, cfg) {
  var nome     = p.nome || "Participante";
  var palestra = p.palestras ? p.palestras.nome : "";

  var arquivo    = DriveApp.getFileById(fileId);
  var blobAnexo  = arquivo.getBlob().setName("qrcode-" + p.token + ".png");
  var blobInline = arquivo.getBlob().setName("qrcode.png");   // cópia para exibição inline

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">' +
    '<div style="max-width:560px;margin:24px auto;padding:0 16px;">' +
      '<div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">' +
        '<div style="background:' + cfg.cor + ';padding:28px 32px;text-align:center;">' +
          '<h1 style="color:#fff;font-size:20px;margin:0;">' + esc(cfg.nomeEvento) + '</h1>' +
        '</div>' +
        '<div style="padding:28px 32px;text-align:center;">' +
          '<p style="font-size:16px;color:#1a1a1a;margin:0 0 8px;">Ola, ' + esc(nome) + '!</p>' +
          '<p style="font-size:15px;color:#333;line-height:1.7;margin:0 0 20px;">' +
            'Este e o seu QR Code de acesso' + (palestra ? ' para <strong>' + esc(palestra) + '</strong>' : '') + '. ' +
            'Apresente-o na entrada do evento.</p>' +
          '<img src="cid:qrcode" alt="QR Code" style="width:240px;height:240px;border:1px solid #eee;border-radius:12px;">' +
          '<p style="margin:16px 0 0;font-size:13px;color:#888;font-family:monospace;">' + esc(p.token) + '</p>' +
        '</div>' +
        '<div style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;text-align:center;">' +
          '<p style="margin:0;font-size:13px;color:#888;">' + esc(cfg.rodape) + '</p>' +
        '</div>' +
      '</div>' +
    '</div></body></html>';

  GmailApp.sendEmail(p.email, QR_ASSUNTO + " — " + cfg.nomeEvento, "Seu QR Code de acesso esta em anexo.", {
    htmlBody:     html,
    inlineImages: { qrcode: blobInline },
    attachments:  [blobAnexo],
    name:         cfg.nomeEvento
  });
}

/**
 * EnviarQR.gs — Envia a CONFIRMAÇÃO DE INSCRIÇÃO + QR Code por e-mail.
 * Reaproveita helpers GLOBAIS do Code.gs (supaFetch, esc) — mesmo projeto Apps Script.
 *
 * MODELO (opção B): o QR é gerado a partir do TOKEN (quickchart.io), sem depender
 * do Google Drive. Basta o participante existir no Supabase com e-mail.
 *
 * ENVIO EM LOTES + TETO DIÁRIO:
 *   - Configure o gatilho horário (menu → "Configurar envio de QR (1x/hora)").
 *   - Cada execução envia até LOTE_POR_EXECUCAO e-mails (cabe no limite de 6 min).
 *   - Para no máximo LIMITE_DIARIO por dia (conta guardada em Script Properties)
 *     e respeita a cota do Gmail (MailApp.getRemainingDailyQuota).
 *   - Marca qr_enviado=true após enviar — rodar de novo não duplica.
 *
 * PRÉ-REQUISITOS
 *   1. Coluna qr_enviado (boolean) em participantes  → já criada no import.
 *   2. Colunas local/endereco/periodo/hora em palestras (db/adicionar-local-sessoes.sql).
 *   3. SUPABASE_SERVICE_KEY em Script Properties (a mesma do Code.gs).
 *
 * Rode uma vez enviarQRParaToken("<token de um inscrito>") para testar antes de ligar o gatilho.
 */

var QR_ASSUNTO   = "Confirmação de inscrição no Congresso";
var EVENTO_TEMA  = "Educar para COMviver: Ribeirão 170 anos: memória, transformação e identidade";
var EVENTO_DATA  = "21/07/2026";
var REMETENTE    = "Congresso Municipal de Educação / 2026";
var SITE_VALIDAR = "https://smedigital.com.br/congresso/validar.html";

var LOTE_POR_EXECUCAO = 150;   // por execução do gatilho (cabe nos 6 min)
var LIMITE_DIARIO     = 1300;  // teto de e-mails por dia

// ── ENVIO EM LOTE (gatilho horário) ───────────────────────────
function enviarQRCodesPendentes() {
  try {
    var props = PropertiesService.getScriptProperties();
    var tz    = Session.getScriptTimeZone();
    var hoje  = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");

    // contador diário
    if (props.getProperty("qr_dia") !== hoje) {
      props.setProperty("qr_dia", hoje);
      props.setProperty("qr_contagem", "0");
    }
    var enviadosHoje = parseInt(props.getProperty("qr_contagem") || "0", 10);
    var restanteDia  = LIMITE_DIARIO - enviadosHoje;
    if (restanteDia <= 0) { Logger.log("Teto diário (" + LIMITE_DIARIO + ") atingido."); return; }

    var cota = MailApp.getRemainingDailyQuota();
    if (cota < 5) { Logger.log("Cota do Gmail quase esgotada (" + cota + ")."); return; }

    var lote = Math.min(LOTE_POR_EXECUCAO, restanteDia, cota);

    var lista = supaFetch(
      "participantes?or=(qr_enviado.is.null,qr_enviado.eq.false)&email=not.is.null" +
      "&select=token,nome,email,palestra_id,palestras(nome,local,endereco)" +
      "&order=nome.asc&limit=" + lote,
      "GET", null
    );
    if (lista && lista.error) { Logger.log("Erro ao buscar pendentes: " + JSON.stringify(lista)); return; }
    if (!Array.isArray(lista) || lista.length === 0) { Logger.log("Nenhum pendente."); return; }

    var cfg = _qrConfigEmail();
    var enviados = 0, erros = 0;

    lista.forEach(function(p) {
      try {
        if (!p.email) { erros++; return; }
        _enviarConfirmacao(p, cfg);
        supaFetch("participantes?token=eq." + encodeURIComponent(p.token), "PATCH", { qr_enviado: true });
        enviados++;
      } catch (e) {
        erros++;
        Logger.log("Erro token " + p.token + ": " + e.message);
      }
    });

    props.setProperty("qr_contagem", String(enviadosHoje + enviados));
    Logger.log("Enviados: " + enviados + " | Erros: " + erros +
               " | Total hoje: " + (enviadosHoje + enviados) + "/" + LIMITE_DIARIO);
  } catch (e) {
    Logger.log("Erro geral (QR): " + e.message);
  }
}

// ── TESTE / REENVIO PONTUAL (sem teto diário) ─────────────────
function enviarQRParaToken(token) {
  var lista = supaFetch(
    "participantes?token=eq." + encodeURIComponent(token) +
    "&select=token,nome,email,palestra_id,palestras(nome,local,endereco)&limit=1",
    "GET", null
  );
  if (!Array.isArray(lista) || lista.length === 0) { Logger.log("Token nao encontrado."); return; }
  var p = lista[0];
  if (!p.email) { Logger.log("Participante sem e-mail."); return; }
  _enviarConfirmacao(p, _qrConfigEmail());
  supaFetch("participantes?token=eq." + encodeURIComponent(p.token), "PATCH", { qr_enviado: true });
  Logger.log("Enviado: " + p.email);
}

// ── GATILHO ───────────────────────────────────────────────────
function configurarGatilhoQR() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "enviarQRCodesPendentes") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("enviarQRCodesPendentes").timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert(
    "Gatilho configurado!\n\nAte " + LOTE_POR_EXECUCAO + " e-mails por hora, no maximo " +
    LIMITE_DIARIO + " por dia."
  );
}

// Zera o contador diário (para reenviar mais hoje, em teste).
function resetContadorDiario() {
  PropertiesService.getScriptProperties().deleteProperty("qr_contagem");
  PropertiesService.getScriptProperties().deleteProperty("qr_dia");
  Logger.log("Contador diario zerado.");
}

// ── INTERNOS ──────────────────────────────────────────────────
function _qrConfigEmail() {
  var c = supaFetch("email_config?id=eq.1&select=*&limit=1", "GET", null);
  c = (Array.isArray(c) && c.length) ? c[0] : {};
  return { cor: c.cor_primaria || "#1f4e79" };
}

function _horarioDoPeriodo(palestraId) {
  var id = String(palestraId || "");
  if (/_M\d*$/.test(id)) return "08:00 (manhã)";
  if (/_T\d*$/.test(id)) return "14:00 (tarde)";
  if (/_N\d*$/.test(id)) return "19:00 (noite)";
  return "";
}

// Gera o QR do token via quickchart e devolve um blob PNG para inline/anexo.
function _qrBlobDoToken(token) {
  var alvo = SITE_VALIDAR + "?t=" + encodeURIComponent(token);
  var url  = "https://quickchart.io/qr?text=" + encodeURIComponent(alvo) + "&size=400&margin=2&ecLevel=M";
  return UrlFetchApp.fetch(url).getBlob().setName("qrcode.png");
}

function _enviarConfirmacao(p, cfg) {
  var nome     = p.nome || "Participante";
  var palestra = p.palestras ? (p.palestras.nome || "")     : "";
  var local    = p.palestras ? (p.palestras.local || "")    : "";
  var endereco = p.palestras ? (p.palestras.endereco || "") : "";
  var horario  = _horarioDoPeriodo(p.palestra_id);

  var qrBlob     = _qrBlobDoToken(p.token);
  var blobInline = qrBlob.copyBlob().setName("qrcode.png");
  var blobAnexo  = qrBlob.copyBlob().setName("comprovante-" + p.token + ".png");

  var nomeH     = esc(nome);
  var palestraH = esc(palestra);
  var horarioH  = esc(horario);
  var localH    = esc(local) + (endereco ? " – " + esc(endereco) : "");
  var eventoH   = esc(EVENTO_TEMA);
  var cor       = cfg.cor || "#1f4e79";

  var html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f4f4f4" style="background-color:#f4f4f4;">' +
    '<tr><td align="center" style="padding:24px 12px;">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">' +
        '<tr><td bgcolor="' + cor + '" align="center" style="background-color:' + cor + ';padding:26px 24px;">' +
          '<h1 style="color:#ffffff;font-size:19px;line-height:1.35;margin:0;font-family:Arial,Helvetica,sans-serif;">Confirmação de inscrição no Congresso</h1>' +
        '</td></tr>' +
        '<tr><td style="padding:28px 34px;font-family:Arial,Helvetica,sans-serif;color:#333333;font-size:15px;line-height:1.7;">' +
          '<p style="margin:0 0 16px;">Prezado(a), <strong>' + nomeH + '</strong></p>' +
          '<p style="margin:0 0 16px;">Sua inscrição na palestra <strong>' + palestraH + '</strong> do Congresso da Secretaria Municipal de Educação: &ldquo;' + eventoH + '&rdquo; foi confirmada com sucesso!</p>' +
          '<p style="margin:0 0 16px;">Agradecemos sua inscrição e temos a satisfação de contar com sua presença neste importante momento de formação, troca de experiências e fortalecimento de conhecimentos.</p>' +
          '<p style="margin:0 0 10px;">Para agilizar o processo de credenciamento e garantir seu acesso ao evento, é indispensável apresentar o <strong>QR Code de confirmação</strong>, podendo ser:</p>' +
          '<ul style="margin:0 0 16px;padding-left:22px;">' +
            '<li style="margin:0 0 6px;">exibido na tela do celular (print ou arquivo digital); ou</li>' +
            '<li style="margin:0;">apresentado de forma impressa.</li>' +
          '</ul>' +
          '<p style="margin:0 0 22px;">Recomendamos que o QR Code esteja acessível no momento da entrada, evitando atrasos na validação de presença.</p>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#eef3f8" style="background-color:#eef3f8;border:1px solid #d6e2ef;border-radius:8px;">' +
            '<tr><td style="padding:16px 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1f4e79;">' +
              '<p style="margin:0 0 6px;"><strong>Data:</strong> ' + esc(EVENTO_DATA) + '</p>' +
              '<p style="margin:0 0 6px;"><strong>Horário:</strong> ' + horarioH + '</p>' +
              '<p style="margin:0;"><strong>Local:</strong> ' + localH + '</p>' +
            '</td></tr>' +
          '</table>' +
          '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 0 4px;">' +
            '<img src="cid:qrcode" width="220" height="220" alt="QR Code" style="display:block;margin:0 auto;width:220px;height:220px;border:1px solid #e5e5e5;border-radius:12px;">' +
            '<p style="margin:12px 0 0;font-size:12px;color:#999999;font-family:monospace;">' + esc(p.token) + '</p>' +
          '</td></tr></table>' +
          '<p style="margin:22px 0 4px;">Estamos felizes em recebê-lo(a) e desejamos que sua participação seja enriquecedora e inspiradora.</p>' +
          '<p style="margin:18px 0 0;">Atenciosamente,</p>' +
          '<p style="margin:4px 0 0;"><strong>Equipe Organizadora do<br>Congresso Municipal de Educação / 2026.</strong></p>' +
        '</td></tr>' +
      '</table>' +
    '</td></tr></table>' +
    '</body></html>';

  GmailApp.sendEmail(p.email, QR_ASSUNTO, "Sua inscrição foi confirmada. Apresente o QR Code (em anexo) na entrada do evento.", {
    htmlBody:     html,
    inlineImages: { qrcode: blobInline },
    attachments:  [blobAnexo],
    name:         REMETENTE
  });
}

/**
 * CODE.GS  — núcleo do projeto Apps Script do Congresso
 * Responsabilidades:
 *   1. Configuração única (CONFIG + Supabase) para todo o projeto
 *   2. Roteador do Web App (?action=syncInscritos)
 *   3. Trazer dados do Supabase para a planilha (participantes e presenças)
 *   4. Diagnóstico e menu (onOpen)
 *
 * Envio dos comprovantes por e-mail (QR via quickchart)  -> EnviarQR.gs
 * Inserir/atualizar inscritos da planilha no Supabase     -> SincronizarPlanilha.gs
 * Geração e exibição do QR: feita pelo token (quickchart / hotsite). Sem Google Drive.
 *
 * SEGURANCA (ver SECURITY.md na raiz do repo):
 *   - A chave do Supabase vem de Script Properties (SUPABASE_SERVICE_KEY),
 *     e deve ser a service_role (roda no servidor, nunca exposta ao navegador).
 *   - As acoes do gerente (syncInscritos) exigem que o e-mail do chamador
 *     seja um gerente cadastrado em validadores.
 */

// ── CONFIGURACAO DA PLANILHA ──────────────────────────────────
// Definido UMA vez aqui e reutilizado por SincronizarPlanilha.gs e EnviarQR.gs.
var CONFIG = {
  PLANILHA_ID:       "1cMYIDoAaWsL4v9bO9kh_jeBA3YC5peDuZsKX0EN7VRE",
  ABA_PARTICIPANTES: "PARTICIPANTES_unificado",
  ABA_PALESTRAS:     "PALESTRAS",
  ABA_PRESENCAS:     "PRESENCAS"
};

var SUPABASE_URL = "https://iqldovwttomkjkoakosc.supabase.co";  // projeto do gom
var SUPABASE_SCHEMA = "presenca";                              // schema da presença

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

  // Rota sensivel (dashboard do gerente): exige gerente autorizado
  if (action === "syncInscritos") {
    if (!gerenteAutorizado(p.email)) {
      return json({ ok: false, mensagem: "nao autorizado" });
    }
    try {
      sincronizarAlteracoesInscritos();
      return json({ ok: true, mensagem: "Inscritos sincronizados com sucesso." });
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
      "apikey":          key,
      "Authorization":   "Bearer " + key,
      "Content-Type":    "application/json",
      "Prefer":          prefer,
      "Accept-Profile":  SUPABASE_SCHEMA,
      "Content-Profile": SUPABASE_SCHEMA
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


// ── SUPABASE → PLANILHA: PARTICIPANTES ────────────────────────
// Traz todos os inscritos do Supabase para a aba PARTICIPANTES.
// Use antes de editar/inserir na planilha (fluxo: puxar -> editar -> subir).
function sincronizarParticipantes() {

  try {

    var ss  = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
    var aba = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
    if (!aba) {
      SpreadsheetApp.getUi().alert("Aba nao encontrada: " + CONFIG.ABA_PARTICIPANTES);
      return;
    }

    var data = supaFetch(
      "participantes?select=token,nome,email,cpf,palestra_id,codigo_funcional,origem,unidade" +
      "&order=nome.asc",
      "GET", null
    );

    if (!Array.isArray(data)) {
      SpreadsheetApp.getUi().alert("Erro ao buscar participantes:\n" + JSON.stringify(data));
      return;
    }

    // Limpa mantendo cabecalho
    var ultimaLinha = aba.getLastRow();
    if (ultimaLinha > 1) {
      aba.getRange(2, 1, ultimaLinha - 1, aba.getLastColumn()).clearContent();
    }

    aba.getRange(1, 1, 1, 8).setValues([[
      "TOKEN", "NOME", "EMAIL", "CPF", "PALESTRA_ID",
      "CODIGO_FUNCIONAL", "ORIGEM", "UNIDADE"
    ]]);

    if (data.length === 0) {
      SpreadsheetApp.getUi().alert("Nenhum participante encontrado no Supabase.");
      return;
    }

    var linhas = data.map(function(p) {
      return [
        p.token            || "",
        p.nome             || "",
        p.email            || "",
        p.cpf              || "",
        p.palestra_id      || "",
        p.codigo_funcional || "",
        p.origem           || "",
        p.unidade          || ""
      ];
    });

    aba.getRange(2, 1, linhas.length, 8).setValues(linhas);

    SpreadsheetApp.getUi().alert(
      "Participantes importados!\n\n" +
      linhas.length + " inscrito(s) trazido(s) do Supabase.\n\n" +
      "Para inserir novos: adicione as linhas e rode\n" +
      "Eventos -> Subir novos inscritos da planilha."
    );

  } catch (erro) {
    SpreadsheetApp.getUi().alert("Erro: " + erro.message);
  }

}


// ── SUPABASE → PLANILHA: PRESENCAS ───────────────────────────
// Importa todas as presencas do Supabase para a aba PRESENCAS.
// Util para relatorios e analises na planilha.
function sincronizarPresencas() {

  try {

    var ss  = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
    var aba = ss.getSheetByName(CONFIG.ABA_PRESENCAS);
    if (!aba) {
      SpreadsheetApp.getUi().alert("Aba nao encontrada: " + CONFIG.ABA_PRESENCAS);
      return;
    }

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

    // Supabase -> planilha
    .addItem("Trazer inscritos do Supabase",  "sincronizarParticipantes")
    .addItem("Trazer presencas do Supabase",  "sincronizarPresencas")

    .addSeparator()
    // Planilha -> Supabase
    .addItem("Subir novos inscritos da planilha",       "sincronizarNovosInscritos")
    .addItem("Subir alteracoes de inscritos",           "sincronizarAlteracoesInscritos")
    .addItem("Configurar sync automatico (15 min)",     "configurarSyncInscritos")

    .addSeparator()
    // Envio dos comprovantes por e-mail (EnviarQR.gs)
    .addItem("Enviar comprovantes pendentes (lote)",   "enviarQRCodesPendentes")
    .addItem("Configurar envio automatico (1x/hora)",  "configurarGatilhoQR")
    .addItem("TESTE — enviar aos meus e-mails",        "testarMeuEmail")
    .addItem("Zerar contador do dia",                  "resetContadorDiario")

    .addToUi();

}

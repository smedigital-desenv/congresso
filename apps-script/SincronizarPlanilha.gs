/**
 * SINCRONIZARPLANILHA.GS
 * Sobe da planilha para o Supabase: novos inscritos e alterações.
 *
 * Fluxo de trabalho (definido com a equipe):
 *   1. Eventos -> Trazer inscritos do Supabase   (baixa a base atual)
 *   2. Adicionar/editar linhas na aba PARTICIPANTES_unificado
 *   3. Eventos -> Subir novos inscritos da planilha  (insere os que faltam)
 *      ou   -> Subir alteracoes de inscritos          (atualiza os existentes)
 *
 * NÃO define URL/chave/CONFIG do Supabase aqui — reaproveita CONFIG, supaFetch,
 * SUPABASE_URL e SUPABASE_SCHEMA definidos no Code.gs (mesmo projeto Apps Script).
 *
 * SEM Google Drive: o QR Code é gerado a partir do token (quickchart / hotsite),
 * então basta o participante existir no Supabase com um token válido.
 */


// ── PLANILHA → SUPABASE: NOVOS INSCRITOS ──────────────────────
// Lê a planilha e insere no Supabase APENAS os registros que ainda
// não existem (baseado no token). Não toca em quem já está lá.
function sincronizarNovosInscritos() {

  var ui  = SpreadsheetApp.getUi();
  var ss  = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);

  // 1. Busca tokens que já existem no Supabase (paginado: base > 1000)
  var existentes = supaFetchAll("participantes?select=token");
  var tokensExistentes = {};
  if (Array.isArray(existentes)) {
    existentes.forEach(function(p) { tokensExistentes[String(p.token)] = true; });
  }

  // 2. Busca palestras já existentes no Supabase
  var palestrasExistentes = supaFetch("palestras?select=id", "GET", null);
  var idsExistentes = {};
  if (Array.isArray(palestrasExistentes)) {
    palestrasExistentes.forEach(function(p) { idsExistentes[String(p.id)] = true; });
  }

  // 3. Lê palestras da planilha e insere as novas (se houver aba PALESTRAS)
  var abaPalestras = ss.getSheetByName(CONFIG.ABA_PALESTRAS);
  if (abaPalestras) {
    var rowsPalestras = abaPalestras.getDataRange().getValues();
    for (var i = 1; i < rowsPalestras.length; i++) {
      var pid = String(rowsPalestras[i][0]).trim();
      if (!pid || idsExistentes[pid]) continue;
      supaFetch("palestras?on_conflict=id", "POST", {
        id:            pid,
        nome:          rowsPalestras[i][1],
        carga_horaria: String(rowsPalestras[i][2] || "")
      });
    }
  }

  // 4. Lê participantes e insere apenas os novos
  var abaPartic = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  var dados     = abaPartic.getDataRange().getValues();

  var inseridos   = 0;
  var ignorados   = 0;
  var errosInsert = 0;

  for (var i = 1; i < dados.length; i++) {

    var token      = String(dados[i][0]).trim();
    var nome       = String(dados[i][1]).trim();
    var email      = String(dados[i][2]).trim();
    var cpf        = String(dados[i][3]).replace(/\D/g, "");
    var palestraId = String(dados[i][4]).trim();
    var codigo     = String(dados[i][5] || "").trim();   // F  CODIGO_FUNCIONAL
    var origem     = String(dados[i][6] || "").trim();   // G  ORIGEM
    var unidade    = String(dados[i][7] || "").trim();   // H  UNIDADE

    if (!token)                  { ignorados++; continue; }
    if (tokensExistentes[token]) { ignorados++; continue; }

    try {
      supaFetch("participantes?on_conflict=token", "POST", {
        token:            token,
        nome:             nome,
        email:            email,
        cpf:              cpf,
        palestra_id:      palestraId,
        codigo_funcional: codigo  || null,
        origem:           origem  || null,
        unidade:          unidade || null
      });
      inseridos++;
    } catch(e) {
      Logger.log("Erro insert token " + token + ": " + e.message);
      errosInsert++;
    }

  }

  ui.alert(
    "Novos inscritos enviados ao Supabase!\n\n" +
    "Inseridos:    " + inseridos   + "\n" +
    "Ignorados:    " + ignorados   + " (já existiam ou sem token)\n" +
    "Erros insert: " + errosInsert + "\n\n" +
    "Comprovantes: rode Eventos -> Enviar comprovantes pendentes (lote)."
  );

}


// ── PLANILHA → SUPABASE: ALTERAÇÕES ───────────────────────────
// Varre todos os participantes e atualiza no Supabase
// quem tiver nome, email, cpf ou palestra diferente.
// Configurar gatilho: Eventos → Configurar sync automatico (15 min)
function sincronizarAlteracoesInscritos() {

  var ss    = SpreadsheetApp.openById(CONFIG.PLANILHA_ID);
  var aba   = ss.getSheetByName(CONFIG.ABA_PARTICIPANTES);
  var dados = aba.getDataRange().getValues();

  // Busca todos os participantes do Supabase de uma vez (paginado: base > 1000)
  var existentes = supaFetchAll(
    "participantes?select=token,nome,email,cpf,palestra_id,codigo_funcional,origem,unidade"
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
    var codigo     = String(dados[i][5] || "").trim();   // F  CODIGO_FUNCIONAL
    var origem     = String(dados[i][6] || "").trim();   // G  ORIGEM
    var unidade    = String(dados[i][7] || "").trim();   // H  UNIDADE

    if (!token) { ignorados++; continue; }

    var atual = mapSupa[token];

    // Token nao existe no Supabase — pula (use "Subir novos inscritos")
    if (!atual) { ignorados++; continue; }

    // Verifica se algo mudou
    var mudou =
      atual.nome        !== nome       ||
      atual.email       !== email      ||
      atual.cpf         !== cpf        ||
      String(atual.palestra_id)      !== palestraId ||
      String(atual.codigo_funcional || "") !== codigo ||
      String(atual.origem  || "")    !== origem      ||
      String(atual.unidade || "")    !== unidade;

    if (!mudou) { ignorados++; continue; }

    // Atualiza no Supabase
    var res = supaFetch(
      "participantes?token=eq." + encodeURIComponent(token),
      "PATCH",
      {
        nome: nome, email: email, cpf: cpf, palestra_id: palestraId,
        codigo_funcional: codigo  || null,
        origem:           origem  || null,
        unidade:          unidade || null
      }
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

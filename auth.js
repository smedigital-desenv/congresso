/**
 * auth.js — Login via Supabase Auth (Google) reaproveitando o projeto do GOM.
 *
 * Requer (nesta ordem, ANTES deste script):
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="config.js"></script>
 *
 * Usa o MESMO projeto Supabase do GOM (mesmo provider Google + tabela de allowlist
 * `presenca.validadores`), mas com storageKey PRÓPRIO ("presenca-auth") → a sessão
 * da presença é INDEPENDENTE da do GOM. Login, logout e troca de conta na presença
 * não afetam o GOM (e vice-versa). O perfil (fiscal/gerente) vem de validadores.
 */
(function() {

  if (!window.supabase || !window.supabase.createClient) {
    console.error("supabase-js nao carregado. Inclua o CDN antes de auth.js.");
    return;
  }

  var KEY_EMAIL  = "fiscal_email";
  var KEY_PERFIL = "fiscal_perfil";
  var KEY_NOME   = "fiscal_nome";

  // Mesmo PROJETO do GOM (mesmo provider Google + validadores), mas com storageKey
  // PRÓPRIO → sessão INDEPENDENTE do GOM. Assim login/logout/troca de conta na
  // presença não afetam o GOM (e vice-versa).
  window.sb = window.supabase.createClient(SUPA_PROJECT_URL, SUPA_KEY, {
    auth: {
      persistSession:     true,
      autoRefreshToken:   true,
      detectSessionInUrl: true,
      flowType:           "pkce",
      storage:            window.localStorage,
      storageKey:         "presenca-auth"
    }
  });

  function limparCache() {
    localStorage.removeItem(KEY_EMAIL);
    localStorage.removeItem(KEY_PERFIL);
    localStorage.removeItem(KEY_NOME);
  }

  // Login com Google. Força o seletor de conta (prompt=select_account) para permitir
  // trocar de conta a cada login (útil em dispositivos compartilhados).
  window.loginGoogle = function() {
    return sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin + window.location.pathname,
        queryParams: { prompt: "select_account" }
      }
    });
  };

  // Logout da presença: encerra a sessão PRÓPRIA da presença (storageKey isolado).
  // Como o GOM usa outra storageKey, a sessão do GOM não é afetada.
  window.logoutAuth = function() {
    limparCache();
    return sb.auth.signOut().catch(function(){}).then(function() {
      window.location.href = "index.html";
    });
  };

  // Verifica a sessão e confere o e-mail na allowlist (presenca.validadores).
  // Resolve com:
  //   { email, perfil, nome }  -> autenticado e autorizado
  //   { naoAutorizado: true }  -> logado no Google mas fora da allowlist (NÃO desloga)
  //   null                     -> sem sessão
  function carregarSessao() {
    return sb.auth.getSession().then(function(res) {
      var session = res && res.data ? res.data.session : null;
      if (!session || !session.user || !session.user.email) { return null; }

      var email = session.user.email.toLowerCase();
      return fetch(
        SUPA_URL + "/validadores?email=eq." + encodeURIComponent(email) + "&select=email,nome,perfil&limit=1",
        { headers: {
            "apikey": SUPA_KEY,
            "Authorization": "Bearer " + session.access_token,
            "Accept-Profile": SUPA_SCHEMA
          } }
      )
      .then(function(r){ if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(function(data) {
        if (!Array.isArray(data)) throw new Error("resposta inesperada");
        if (data.length === 0) {
          // Fora da allowlist: encerra a sessão da presença (isolada; não afeta o GOM),
          // liberando a troca de conta no próximo login.
          limparCache();
          return sb.auth.signOut().catch(function(){}).then(function() {
            return { naoAutorizado: true, email: email };
          });
        }
        var v = data[0];
        var perfil = (v.perfil || "fiscal").toString().trim().toLowerCase();
        localStorage.setItem(KEY_EMAIL,  v.email);
        localStorage.setItem(KEY_PERFIL, perfil);
        localStorage.setItem(KEY_NOME,   v.nome || "");
        return { email: v.email, perfil: perfil, nome: v.nome || "" };
      })
      .catch(function() {
        // Erro transitório na checagem: usa o cache se houver, não desloga.
        var cachedEmail = localStorage.getItem(KEY_EMAIL);
        if (cachedEmail) {
          return { email: cachedEmail,
                   perfil: (localStorage.getItem(KEY_PERFIL) || "fiscal"),
                   nome: localStorage.getItem(KEY_NOME) || "" };
        }
        return { naoAutorizado: true, email: email };
      });
    });
  }

  // Verificação memoizada — páginas e menu compartilham o mesmo resultado.
  window.sessaoPronta = carregarSessao();
  window.verificarSessao = function() { return window.sessaoPronta; };

  // Guarda de página protegida. perfilReq opcional: "gerente".
  window.protegerPagina = function(perfilReq) {
    return window.verificarSessao().then(function(user) {
      if (!user) { window.location.href = "index.html"; return null; }
      if (user.naoAutorizado) { window.location.href = "index.html?erro=nao_autorizado"; return null; }
      if (perfilReq && user.perfil !== perfilReq) { window.location.href = "index.html"; return null; }
      return user;
    });
  };

})();

(function () {
  "use strict";

  var cfg = window.LOWLAB_SUPABASE || {};
  var $ = function (id) { return document.getElementById(id); };
  var SITE = location.origin;
  var FN_CADASTRO = (cfg.url || "") + "/functions/v1/affiliate-signup";
  var LINK_CAKTO = /^https:\/\/pay\.cakto\.com\.br\/[^\s"'<>]+$/;
  var APELIDO = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  var RESERVADOS = ["admin", "lowlab", "parceiros", "campus", "acesso", "suporte", "oficial", "circulo"];
  var PLANOS = [
    // o campo link_circulo guarda o link do plano Vitalício (nome mantido no banco)
    { id: "campus", nome: "Mensal", preco: 297, periodo: "/mês", campo: "link_campus", ganho: "por mês, enquanto o aluno assinar", convite: "https://app.cakto.com.br/affiliate/invite/826bce51-e635-4962-9612-199ddb91c440" },
    { id: "circulo", nome: "Vitalício", preco: 597, periodo: " (pagamento único)", campo: "link_circulo", ganho: "por venda", convite: "https://app.cakto.com.br/affiliate/invite/b5a0b23f-83ae-47c1-9930-88a39b47f107" }
  ];
  var COMISSAO = 0.5;

  var sb = null;
  var st = { user: null, profile: null, aff: null, lessons: [], done: new Set(), materials: [], filtro: "todos" };

  // ---------- utilidades ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function brl(v) { return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
  function views(id) {
    ["vCarregando", "vEntrar", "vNaoParceiro", "vBloqueado", "vApp"].forEach(function (v) { $(v).hidden = v !== id; });
  }
  function msg(el, txt, tipo) { el.textContent = txt || ""; el.className = "msg" + (tipo ? " " + tipo : ""); }
  var toastTimer = 0;
  function toast(txt) {
    var t = $("toast"); t.textContent = txt; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }
  // lembretes do que o parceiro já fez neste navegador (só para guiar os passos)
  function marca(k) { try { return localStorage.getItem("ll_parc_" + k) === "1"; } catch (e) { return false; } }
  function marcar(k) { try { localStorage.setItem("ll_parc_" + k, "1"); } catch (e) {} }
  function botoesConvite(classe) {
    return PLANOS.map(function (p) {
      return '<a class="btn small' + (classe || "") + '" href="' + esc(p.convite) + '" target="_blank" rel="noopener" data-convite="' + p.id + '">Afiliar ao ' + esc(p.nome) + " ↗</a>";
    }).join("");
  }
  function ligarConvites() {
    document.querySelectorAll("#conteudo [data-convite]").forEach(function (a) {
      a.addEventListener("click", function () { marcar("conv_" + a.getAttribute("data-convite")); });
    });
  }
  async function copiar(txt) {
    try { await navigator.clipboard.writeText(txt); toast("Copiado!"); }
    catch (e) { window.prompt("Copie o texto:", txt); }
  }
  function linkPagina() { return st.aff && st.aff.slug ? SITE + "/p/" + st.aff.slug : ""; }
  function paginaPronta() { return !!(st.aff && st.aff.slug && (st.aff.link_campus || st.aff.link_circulo)); }
  function primeiroNome() {
    var n = (st.profile && st.profile.full_name) || (st.aff && st.aff.display_name) || "";
    return n.split(" ")[0] || "parceiro";
  }
  function youtubeId(url) {
    var m = String(url || "").match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  }
  function traduz(e) {
    var m = (e && (e.message || e.error_description || e.msg)) || String(e || "");
    if (/invalid login|credentials/i.test(m)) return "E-mail ou senha incorretos.";
    if (/rate limit|only request this after|security purposes/i.test(m)) return "Muitas tentativas seguidas. Espere 1 minuto e tente de novo.";
    if (/network|fetch/i.test(m)) return "Sem conexão. Verifique sua internet e tente de novo.";
    if (/duplicate key|affiliates_slug_key/i.test(m)) return "Esse apelido já está em uso. Escolha outro.";
    if (/check constraint/i.test(m)) return "Algum campo não está no formato certo. Confira e tente de novo.";
    return "Algo deu errado. Tente de novo em instantes.";
  }

  // ---------- olho da senha / abas / sair ----------
  document.querySelectorAll("[data-eye]").forEach(function (b) {
    b.addEventListener("click", function () {
      var i = $(b.getAttribute("data-eye")); var vis = i.type === "password";
      i.type = vis ? "text" : "password"; b.textContent = vis ? "Ocultar" : "Mostrar";
    });
  });
  document.querySelectorAll("[data-auth-tab]").forEach(function (b) {
    b.addEventListener("click", function () { abaAuth(b.getAttribute("data-auth-tab")); });
  });
  function abaAuth(qual) {
    document.querySelectorAll("[data-auth-tab]").forEach(function (b) { b.classList.toggle("active", b.getAttribute("data-auth-tab") === qual); });
    $("fLogin").hidden = qual !== "login";
    $("fCadastro").hidden = qual !== "cadastro";
  }
  document.querySelectorAll("[data-sair]").forEach(function (b) {
    b.addEventListener("click", async function () { await sb.auth.signOut(); location.hash = ""; location.reload(); });
  });
  $("bMenu").addEventListener("click", function () { $("side").classList.toggle("open"); });
  $("modal").addEventListener("click", function (e) { if (e.target === $("modal") || e.target.hasAttribute("data-fechar")) fecharModal(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !$("modal").hidden) fecharModal(); });
  function abrirModal(html) { $("modalCorpo").innerHTML = html; $("modal").hidden = false; }
  function fecharModal() { $("modal").hidden = true; $("modalCorpo").innerHTML = ""; }

  // ---------- login / cadastro ----------
  $("fLogin").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var email = $("lEmail").value.trim().toLowerCase(), senha = $("lSenha").value, out = $("mLogin"), b = $("bLogin");
    if (!email || !senha) { msg(out, "Preencha e-mail e senha.", "err"); return; }
    b.disabled = true; b.textContent = "Entrando…"; msg(out, "");
    var r = await sb.auth.signInWithPassword({ email: email, password: senha });
    b.disabled = false; b.textContent = "Entrar";
    if (r.error) { msg(out, traduz(r.error), "err"); return; }
    await carregar();
  });

  $("bEsqueci").addEventListener("click", async function () {
    var email = $("lEmail").value.trim().toLowerCase(), out = $("mLogin");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { msg(out, "Digite seu e-mail acima primeiro.", "err"); $("lEmail").focus(); return; }
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: SITE + "/acesso.html" });
    if (r.error) { msg(out, traduz(r.error), "err"); return; }
    msg(out, "Se " + email + " tiver conta, o link para criar uma nova senha chega em até 2 minutos. Olhe também o Spam.", "ok");
  });

  $("fCadastro").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var nome = $("cNome").value.trim(), email = $("cEmail").value.trim().toLowerCase(), out = $("mCadastro"), b = $("bCadastro");
    if (nome.length < 2) { msg(out, "Digite seu nome.", "err"); $("cNome").focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { msg(out, "Digite um e-mail válido.", "err"); $("cEmail").focus(); return; }
    if (!$("cAceite").checked) { msg(out, "Para continuar, aceite os Termos de Uso.", "err"); return; }
    b.disabled = true; b.textContent = "Criando…"; msg(out, "");
    try {
      var resp = await fetch(FN_CADASTRO, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: nome, email: email, empresa: $("cEmpresa").value })
      });
      var j = await resp.json().catch(function () { return {}; });
      if (j.ok) {
        msg(out, "Pronto! Enviamos para " + email + " o link para criar sua senha. Ele chega em até 2 minutos; olhe também o Spam e Promoções.", "ok");
        b.textContent = "E-mail enviado";
        return;
      }
      var erros = {
        espera: "Muitos pedidos seguidos. Espere alguns minutos e tente de novo.",
        bloqueado: "Não foi possível criar a conta de parceiro com esse e-mail. Fale com o suporte.",
        email: "Digite um e-mail válido.", nome: "Digite seu nome."
      };
      msg(out, erros[j.error] || "Não foi possível concluir agora. Tente de novo em instantes.", "err");
    } catch (e) { msg(out, traduz(e), "err"); }
    b.disabled = false; b.textContent = "Criar minha conta de parceiro";
  });

  $("bVirarParceiro").addEventListener("click", async function () {
    var b = $("bVirarParceiro"), out = $("mVirar");
    b.disabled = true; b.textContent = "Ativando…"; msg(out, "");
    try {
      var s = await sb.auth.getSession();
      var tok = s.data.session && s.data.session.access_token;
      var resp = await fetch(FN_CADASTRO, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: "{}" });
      var j = await resp.json().catch(function () { return {}; });
      if (j.ok) { await carregar(); return; }
      msg(out, j.status === "blocked" ? "Essa conta está bloqueada para parceria. Fale com o suporte." : "Não foi possível ativar agora. Tente de novo.", "err");
    } catch (e) { msg(out, traduz(e), "err"); }
    b.disabled = false; b.textContent = "Ativar minha conta de parceiro";
  });

  // ---------- carregamento ----------
  async function carregar() {
    views("vCarregando");
    var s = await sb.auth.getSession();
    var sess = s.data.session;
    if (!sess) { views("vEntrar"); return; }
    st.user = sess.user;
    var p = await sb.from("profiles").select("id,email,full_name,role,status,plan").eq("id", sess.user.id).maybeSingle();
    st.profile = p.data || { email: sess.user.email };
    var a = await sb.from("affiliates").select("user_id,status,slug,display_name,link_campus,link_circulo,created_at").eq("user_id", sess.user.id).maybeSingle();
    st.aff = a.data || null;
    var admin = st.profile.role === "admin" && st.profile.status === "active";
    if (!st.aff && !admin) { $("npEmail").textContent = sess.user.email; views("vNaoParceiro"); return; }
    if (st.aff && st.aff.status === "blocked" && !admin) { views("vBloqueado"); return; }
    await carregarConteudo();
    $("whoNome").textContent = (st.profile.full_name || st.aff && st.aff.display_name || "Parceiro");
    $("whoEmail").textContent = sess.user.email;
    $("navAdmin").hidden = !admin;
    views("vApp");
    rota();
  }

  async function carregarConteudo() {
    var l = await sb.from("affiliate_lessons").select("id,module,position,title,description,video_url,duration,active").order("module").order("position");
    st.lessons = (l.data || []).filter(function (x) { return x.active || st.profile.role === "admin"; });
    var d = await sb.from("affiliate_progress").select("lesson_id").eq("user_id", st.user.id);
    st.done = new Set((d.data || []).map(function (x) { return x.lesson_id; }));
    var m = await sb.from("affiliate_materials").select("id,position,title,kind,body,url,active,section,summary").order("position");
    if (m.error) m = await sb.from("affiliate_materials").select("id,position,title,kind,body,url,active").order("position");
    st.materials = (m.data || []).filter(function (x) { return x.active || st.profile.role === "admin"; });
  }

  // ---------- rotas ----------
  window.addEventListener("hashchange", rota);
  function rota() {
    if ($("vApp").hidden) return;
    var v = (location.hash.slice(1) || "inicio").split("/")[0];
    if (v === "admin" && st.profile.role !== "admin") v = "inicio";
    if (!st.aff && v !== "admin") v = "admin";
    document.querySelectorAll("[data-nav]").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-nav") === v); });
    if ($("nbMaterial")) $("nbMaterial").hidden = v === "material" || marca("material");
    $("side").classList.remove("open");
    var f = { inicio: telaInicio, pagina: telaPagina, aulas: telaAulas, material: telaMaterial, conta: telaConta, admin: telaAdmin }[v] || telaInicio;
    f();
    window.scrollTo(0, 0);
  }
  function render(html) { $("conteudo").innerHTML = html; $("conteudo").focus({ preventScroll: true }); }

  // ---------- Meu espaço ----------
  function telaInicio() {
    var ativas = st.lessons.filter(function (x) { return x.active; });
    var feitas = ativas.filter(function (x) { return st.done.has(x.id); }).length;
    var pronta = paginaPronta();
    var leu = marca("material");
    var afiliou = pronta || PLANOS.every(function (p) { return marca("conv_" + p.id); });
    var aulasOk = ativas.length > 0 && feitas === ativas.length;
    var feito = [leu, afiliou, pronta, aulasOk, false];
    var agora = feito.indexOf(false);
    var g = function (i) { return i === agora ? " gold" : ""; };
    var passos = [
      ["Leia o material de apoio", "Comece pela seção <b>Comece aqui</b>: como a parceria funciona, as regras e o passo a passo da afiliação.",
        '<a class="btn small' + g(0) + '" href="#material">Abrir material</a>'],
      ["Afilie-se aos dois planos na Cakto", "Crie sua conta na Cakto, se ainda não tiver, e peça a afiliação no Mensal e no Vitalício. A aprovação é automática.",
        botoesConvite(g(1))],
      ["Monte sua página e cole seus links", pronta ? "Página configurada. Seu endereço está pronto para divulgar." : "Na Cakto, em Produtos › Minhas Afiliações › Links, copie seus links. Depois escolha seu apelido e cole os links aqui.",
        '<a class="btn small' + g(2) + '" href="#pagina">' + (pronta ? "Ver página" : "Configurar") + "</a>"],
      ["Conheça o que você vende", ativas.length ? feitas + " de " + ativas.length + " aulas concluídas." : "As aulas em vídeo estão chegando. Até lá, a seção <b>Entenda o que você vende</b> do material explica tudo.",
        ativas.length ? '<a class="btn small' + g(3) + '" href="#aulas">Ver aulas</a>' : '<a class="btn small' + g(3) + '" href="#material">Abrir material</a>'],
      ["Divulgue sua página", pronta ? esc(linkPagina()) : "Disponível assim que sua página estiver configurada.",
        pronta ? '<button class="btn small gold" data-copiar="' + esc(linkPagina()) + '">Copiar link</button>' : ""]
    ];
    render(
      '<div class="page-head"><p class="eyebrow">Seu espaço de parceiro</p><h1>Seu próximo passo, ' + esc(primeiroNome()) + '<span class="dot">.</span></h1>' +
      "<p>Siga os passos na ordem. A venda e a comissão aparecem no seu painel da Cakto.</p></div>" +
      '<div class="destaque"><div><p class="eyebrow">Comece por aqui</p><h3>Material de apoio</h3><p>Regras, afiliação na Cakto, roteiro de live, ganchos de vídeo e mensagens prontas. Tudo o que você precisa para vender está lá, na ordem em que vai usar.</p></div>' +
      '<a class="btn gold" href="#material">Abrir material de apoio</a></div>' +
      '<div class="panel"><p class="eyebrow">Passo a passo</p><div class="steps">' +
      passos.map(function (x, i) { return passo(i + 1, feito[i], x[0], x[1], x[2], i === agora); }).join("") +
      "</div></div>" +
      '<div class="hero" style="margin-top:18px"><div class="panel"><p class="eyebrow">Sua comissão</p><div class="big">50% <span class="gold-text">em cada pagamento</span><small>' +
      PLANOS.map(function (p) { return esc(p.nome) + ": " + brl(p.preco) + p.periodo + " → você recebe " + brl(p.preco * COMISSAO) + " " + p.ganho; }).join("<br>") +
      '</small></div></div><div class="panel"><p class="eyebrow">Para suas lives</p><h3>Campus em demonstração</h3><p class="hint" style="font-size:14px;margin:6px 0 14px">Entre no campus com esta mesma conta para mostrar a plataforma. A primeira aula fica liberada para você apresentar.</p><a class="btn small" href="/campus/" target="_blank" rel="noopener">Abrir o campus ↗</a></div></div>'
    );
    ligarCopiar();
    ligarConvites();
  }
  function passo(n, feito, titulo, texto, acao, agora) {
    return '<div class="step' + (feito ? " done" : "") + (agora ? " now" : "") + '"><div class="num">' + (feito ? "✓" : "0" + n) + '</div><div><h3>' + esc(titulo) + (agora ? ' <span class="badge-now">Agora</span>' : "") + "</h3><p>" + texto + '</p></div><div class="step-acts">' + (acao || "") + "</div></div>";
  }
  function ligarCopiar() {
    document.querySelectorAll("[data-copiar]").forEach(function (b) { b.addEventListener("click", function () { copiar(b.getAttribute("data-copiar")); }); });
  }

  // ---------- Minha página de vendas ----------
  function telaPagina() {
    var a = st.aff || {};
    var link = linkPagina();
    render(
      '<div class="page-head"><p class="eyebrow">Pronta para divulgar</p><h1>Sua página de vendas<span class="dot">.</span></h1>' +
      "<p>É a página oficial da LowLab com os botões de compra apontando para os seus links de afiliado. Plano sem link salvo não aparece na sua página.</p></div>" +
      '<div class="panel"><p class="eyebrow">Antes de colar os links</p><h3>Afilie-se aos dois planos na Cakto</h3>' +
      '<ol class="guia"><li>Clique nos botões abaixo e peça a afiliação. Se ainda não tiver conta na Cakto, ela pede para você criar. A aprovação é automática.<span class="guia-acts">' + botoesConvite(paginaPronta() ? "" : " gold") + '</span></li>' +
      '<li>Na Cakto, abra <b>Produtos › Minhas Afiliações</b>, escolha o produto e vá na aba <b>Links</b>.</li>' +
      '<li>Copie o link completo de cada plano e cole no campo certo aqui embaixo, junto com seu apelido.</li></ol>' +
      '<p class="hint" style="font-size:14px;margin:0">Dúvida? O passo a passo completo está no <a href="#material">material de apoio</a>, na seção Comece aqui.</p></div>' +
      (link ? '<div class="panel"><p class="eyebrow">Seu endereço para divulgar</p><div class="copy-row"><span>' + esc(link) + '</span><a class="btn small" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir ↗</a><button class="btn small gold" data-copiar="' + esc(link) + '">Copiar</button></div></div>' : "") +
      '<form class="panel" id="fPagina" novalidate><div class="grid2"><div><label for="pNome">Seu nome na página</label><input id="pNome" type="text" maxlength="60" value="' + esc(a.display_name || (st.profile && st.profile.full_name) || "") + '" placeholder="Ex.: Equipe Ana Souza"><p class="hint">Aparece discretamente na página como quem indicou.</p></div>' +
      '<div><label for="pSlug">Apelido do endereço</label><input id="pSlug" type="text" maxlength="30" value="' + esc(a.slug || "") + '" placeholder="ex.: ana-souza"><p class="hint">' + esc(SITE) + '/p/<b id="slugPrev">' + esc(a.slug || "seu-apelido") + "</b> · letras minúsculas, números e hífen</p></div></div>" +
      '<p class="eyebrow" style="margin-top:22px">Seus links de afiliado da Cakto</p><p class="hint" style="font-size:14px">Na Cakto: Produtos › Minhas Afiliações › escolha o produto › aba Links. Copie o link completo.</p>' +
      PLANOS.map(function (p) {
        return '<label for="pl_' + p.id + '">' + esc(p.nome) + " · " + brl(p.preco) + p.periodo + "</label>" +
          '<input id="pl_' + p.id + '" type="url" value="' + esc(a[p.campo] || "") + '" placeholder="https://pay.cakto.com.br/…">';
      }).join("") +
      '<button class="btn gold" id="bSalvarPagina" type="submit">Salvar minha página</button><p class="msg" id="mPagina" role="status"></p></form>'
    );
    ligarCopiar();
    ligarConvites();
    $("pSlug").addEventListener("input", function () {
      var v = $("pSlug").value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+/, "").slice(0, 30);
      $("pSlug").value = v; $("slugPrev").textContent = v || "seu-apelido";
    });
    $("fPagina").addEventListener("submit", salvarPagina);
  }
  async function salvarPagina(ev) {
    ev.preventDefault();
    var out = $("mPagina"), b = $("bSalvarPagina");
    var nome = $("pNome").value.trim();
    var slug = $("pSlug").value.trim().replace(/-+$/, "");
    var dados = { display_name: nome || null, slug: slug || null, updated_at: new Date().toISOString() };
    if (nome && (nome.length < 2 || nome.length > 60)) { msg(out, "O nome precisa ter entre 2 e 60 caracteres.", "err"); return; }
    if (!slug) { msg(out, "Escolha um apelido para o endereço da sua página.", "err"); $("pSlug").focus(); return; }
    if (!APELIDO.test(slug)) { msg(out, "O apelido precisa ter de 3 a 30 caracteres: letras minúsculas, números e hífen.", "err"); $("pSlug").focus(); return; }
    if (RESERVADOS.indexOf(slug) >= 0) { msg(out, "Esse apelido é reservado. Escolha outro.", "err"); return; }
    for (var i = 0; i < PLANOS.length; i++) {
      var p = PLANOS[i], v = $("pl_" + p.id).value.trim();
      if (v && (!LINK_CAKTO.test(v) || v.length > 300)) { msg(out, "O link do " + p.nome + " precisa ser um link da Cakto (começa com https://pay.cakto.com.br/).", "err"); $("pl_" + p.id).focus(); return; }
      dados[p.campo] = v || null;
    }
    b.disabled = true; b.textContent = "Salvando…"; msg(out, "");
    var r = await sb.from("affiliates").update(dados).eq("user_id", st.user.id).select("user_id,status,slug,display_name,link_campus,link_circulo,created_at").maybeSingle();
    b.disabled = false; b.textContent = "Salvar minha página";
    if (r.error || !r.data) { msg(out, traduz(r.error || "erro"), "err"); return; }
    st.aff = r.data;
    toast("Página salva!");
    telaPagina();
    msg($("mPagina"), paginaPronta() ? "Tudo certo. Sua página já está no ar." : "Salvo. Cole pelo menos um link para sua página aparecer.", "ok");
  }

  // ---------- Aulas ----------
  function modulos() {
    var vistos = [];
    st.lessons.forEach(function (l) { if (vistos.indexOf(l.module) < 0) vistos.push(l.module); });
    return vistos;
  }
  function telaAulas() {
    var ativas = st.lessons.filter(function (x) { return x.active; });
    var feitas = ativas.filter(function (x) { return st.done.has(x.id); }).length;
    var mods = modulos();
    var lista = st.filtro === "todos" ? ativas : ativas.filter(function (x) { return x.module === st.filtro; });
    render(
      '<div class="page-head"><p class="eyebrow">Conhecimento que vende</p><h1>Aulas para parceiros<span class="dot">.</span></h1>' +
      "<p>" + (ativas.length ? feitas + " de " + ativas.length + " aulas concluídas. Vá no seu ritmo." : "As aulas para parceiros estão chegando. Enquanto isso, configure sua página e veja o material de apoio.") + "</p></div>" +
      (mods.length > 1 ? '<div class="chips"><button class="chip' + (st.filtro === "todos" ? " active" : "") + '" data-filtro="todos">Todos os módulos</button>' +
        mods.map(function (m) { return '<button class="chip' + (st.filtro === m ? " active" : "") + '" data-filtro="' + esc(m) + '">' + esc(m) + "</button>"; }).join("") + "</div>" : "") +
      (lista.length ? '<div class="lessons">' + lista.map(function (l, i) {
        var feito = st.done.has(l.id);
        return '<button class="lesson' + (feito ? " done" : "") + '" data-aula="' + esc(l.id) + '"><div class="top"><span class="n">' + String(ativas.indexOf(l) + 1).padStart(2, "0") + '</span><span class="play">▶</span><span class="mod">' + esc(l.module) + "</span></div>" +
          '<div class="body"><h3>' + esc(l.title) + "</h3>" + (l.description ? "<p>" + esc(l.description) + "</p>" : "") +
          '<div class="meta"><span>' + esc(l.duration || "") + '</span><span class="st">' + (feito ? "✓ Concluída" : "Para assistir") + "</span></div></div></button>";
      }).join("") + "</div>" : '<div class="empty">Nenhuma aula publicada ainda.</div>')
    );
    document.querySelectorAll("[data-filtro]").forEach(function (b) { b.addEventListener("click", function () { st.filtro = b.getAttribute("data-filtro"); telaAulas(); }); });
    document.querySelectorAll("[data-aula]").forEach(function (b) { b.addEventListener("click", function () { abrirAula(b.getAttribute("data-aula")); }); });
  }
  function abrirAula(id) {
    var l = st.lessons.filter(function (x) { return x.id === id; })[0]; if (!l) return;
    var yid = youtubeId(l.video_url), feito = st.done.has(l.id);
    abrirModal(
      '<p class="eyebrow">' + esc(l.module) + '</p><h2 id="modalTitulo">' + esc(l.title) + "</h2>" +
      (yid ? '<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/' + yid + '?rel=0" title="' + esc(l.title) + '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>' : '<div class="empty" style="margin:14px 0">Vídeo em breve.</div>') +
      (l.description ? '<p class="lead">' + esc(l.description) + "</p>" : "") +
      '<button class="btn ' + (feito ? "" : "gold") + '" id="bConcluir" type="button">' + (feito ? "✓ Aula concluída (desmarcar)" : "Marcar como concluída") + "</button>"
    );
    $("bConcluir").addEventListener("click", async function () {
      var b = $("bConcluir"); b.disabled = true;
      var r = feito
        ? await sb.from("affiliate_progress").delete().eq("user_id", st.user.id).eq("lesson_id", l.id)
        : await sb.from("affiliate_progress").insert({ lesson_id: l.id });
      if (r.error && !/duplicate/i.test(r.error.message || "")) { b.disabled = false; toast("Não foi possível salvar. Tente de novo."); return; }
      if (feito) st.done.delete(l.id); else st.done.add(l.id);
      fecharModal(); toast(feito ? "Conclusão removida." : "Aula concluída!"); telaAulas();
    });
  }

  // ---------- Material de apoio ----------
  var SECOES = [
    { id: "comece", titulo: "Comece aqui", desc: "Afilie-se, monte sua página e leia as regras antes de postar." },
    { id: "entenda", titulo: "Entenda o que você vende", desc: "A LowLab, o case do Bruno e como responder às dúvidas." },
    { id: "conteudo", titulo: "Crie conteúdo", desc: "Ganchos, bio, mensagens prontas e como fazer cortes." },
    { id: "live", titulo: "Venda ao vivo", desc: "O roteiro completo da live." },
    { id: "outros", titulo: "Mais materiais", desc: "" }
  ];
  var ICONE = {
    text: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    file: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>'
  };
  function secaoDe(m) { var s = m.section || "outros"; return SECOES.some(function (x) { return x.id === s; }) ? s : "outros"; }
  function minutos(t) { var n = String(t || "").split(/\s+/).filter(Boolean).length; return Math.max(1, Math.round(n / 200)); }
  function resumoDe(m) {
    if (m.summary) return m.summary;
    var l = String(m.body || "").split("\n").filter(function (x) { return x.trim() && !/:$/.test(x.trim()); })[0] || "";
    l = l.replace(/^(•|\d+\.)\s+/, "");
    return l.length > 120 ? l.slice(0, 117).trim() + "…" : l;
  }
  // [fmt-start] transforma o texto simples do material em leitura organizada
  function fmtInline(t) {
    return esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  }
  function fmtRotulo(t) {
    var m = t.match(/^([^:]{2,45}):\s+(.+)$/);
    if (m && m[1].split(/\s+/).length <= 7 && !/[.!?"](?!\d)/.test(m[1]) && !/https?$/.test(m[1])) return "<b>" + fmtInline(m[1]) + ":</b> " + fmtInline(m[2]);
    return fmtInline(t);
  }
  function fmtItem(t) {
    var i = t.indexOf(" → ");
    if (i > 0) return '<li class="obj"><b>' + fmtInline(t.slice(0, i)) + "</b><span>" + fmtInline(t.slice(i + 3)) + "</span></li>";
    return "<li>" + fmtRotulo(t) + "</li>";
  }
  function fmtSnip(t) {
    return '<div class="snip"><pre>' + esc(t) + '</pre><button class="btn small" type="button" data-copiar="' + esc(t) + '">Copiar</button></div>';
  }
  function formatar(body) {
    var ehBullet = function (l) { return /^•\s/.test(l); }, ehNum = function (l) { return /^\d+\.\s/.test(l); };
    var ehTitulo = function (l) { var x = l.trim(); return /:$/.test(x) && x.length <= 90 && !ehBullet(x) && !ehNum(x); };
    var blocos = [], atual = [];
    String(body || "").replace(/\r/g, "").split("\n").forEach(function (l) {
      if (!l.trim()) { if (atual.length) blocos.push(atual); atual = []; } else atual.push(l);
    });
    if (atual.length) blocos.push(atual);
    var html = "";
    blocos.forEach(function (b) {
      var j = 0;
      while (j < b.length) {
        var l = b[j];
        if (ehTitulo(l)) {
          var tit = l.trim().replace(/:$/, "");
          html += '<h4 class="mat-h">' + fmtInline(tit) + "</h4>"; j++;
          var resto = [];
          while (j < b.length && !ehBullet(b[j]) && !ehNum(b[j]) && !ehTitulo(b[j])) { resto.push(b[j]); j++; }
          if (resto.length) html += /exemplo/i.test(tit) ? resto.map(fmtSnip).join("") : fmtSnip(resto.join("\n"));
          continue;
        }
        if (ehBullet(l) || ehNum(l)) {
          var num = ehNum(l), itens = [];
          while (j < b.length && (num ? ehNum(b[j]) : ehBullet(b[j]))) { itens.push(b[j].replace(/^(•|\d+\.)\s+/, "")); j++; }
          html += (num ? '<ol class="mat-ol">' : '<ul class="mat-ul">') + itens.map(fmtItem).join("") + (num ? "</ol>" : "</ul>");
          continue;
        }
        var ps = [];
        while (j < b.length && !ehBullet(b[j]) && !ehNum(b[j]) && !ehTitulo(b[j])) { ps.push(b[j]); j++; }
        html += "<p>" + ps.map(fmtRotulo).join("<br>") + "</p>";
      }
    });
    return html;
  }
  // [fmt-end]
  function linhaMaterial(m) {
    var r = resumoDe(m), txt = '<span class="mat-txt"><b>' + esc(m.title) + "</b>" + (r ? "<small>" + esc(r) + "</small>" : "") + "</span>";
    if (m.kind !== "text" && m.url) {
      return '<a class="mat-row link" href="' + esc(m.url) + '" target="_blank" rel="noopener"><span class="mat-ico">' + (ICONE[m.kind] || ICONE.link) + "</span>" + txt +
        '<span class="mat-go">' + (m.kind === "file" ? "Baixar" : "Abrir") + " ↗</span></a>";
    }
    return '<button class="mat-row" type="button" data-ler="' + esc(m.id) + '"><span class="mat-ico">' + ICONE.text + "</span>" + txt +
      '<span class="mat-go"><em>' + minutos(m.body) + " min</em>Ler →</span></button>";
  }
  function lerMaterial(id) {
    var m = st.materials.filter(function (x) { return x.id === id; })[0]; if (!m) return;
    var s = SECOES.filter(function (x) { return x.id === secaoDe(m); })[0];
    abrirModal(
      '<div class="mat-doc"><p class="eyebrow">' + esc(s ? s.titulo : "Material de apoio") + '</p><h2 id="modalTitulo">' + esc(m.title) + "</h2>" +
      '<div class="mat-top"><span>' + minutos(m.body) + ' min de leitura</span><button class="btn small gold" type="button" data-copiar="' + esc(m.body || "") + '">Copiar tudo</button></div>' +
      formatar(m.body) + "</div>"
    );
    $("modalCorpo").querySelectorAll("[data-copiar]").forEach(function (b) { b.addEventListener("click", function () { copiar(b.getAttribute("data-copiar")); }); });
  }
  function telaMaterial() {
    marcar("material");
    var ativos = st.materials.filter(function (x) { return x.active; });
    var regras = ativos.filter(function (m) { return m.kind === "text" && /^regras/i.test(m.title); })[0];
    var usadas = SECOES.filter(function (s) { return ativos.some(function (m) { return secaoDe(m) === s.id; }); });
    render(
      '<div class="page-head"><p class="eyebrow">Para colocar em prática</p><h1>Material de apoio<span class="dot">.</span></h1><p>Tudo o que você precisa para divulgar a LowLab, na ordem em que vai usar.</p></div>' +
      '<div class="mat-rules"><p><b>Antes de postar:</b> pode mostrar a plataforma, contar a sua experiência e usar os textos daqui. Não pode prometer ganho ou resultado, mostrar print de venda que não é seu ou que foi alterado, usar o nome LowLab em perfil, página ou domínio próprio, nem fazer spam. Quem descumprir é bloqueado.</p>' +
      (regras ? '<button class="btn small gold" type="button" data-ler="' + esc(regras.id) + '">Ler as regras</button>' : "") + "</div>" +
      (usadas.length > 1 ? '<div class="mat-nav">' + usadas.map(function (s, i) { return '<button class="chip" type="button" data-ir="' + s.id + '">' + (i + 1) + ". " + esc(s.titulo) + "</button>"; }).join("") + "</div>" : "") +
      (usadas.length ? usadas.map(function (s, i) {
        var itens = ativos.filter(function (m) { return secaoDe(m) === s.id; });
        return '<section class="mat-sec" id="sec-' + s.id + '"><div class="mat-sec-head"><span class="mat-sec-num">' + (i + 1) + "</span><div><h2>" + esc(s.titulo) + "</h2>" + (s.desc ? "<p>" + esc(s.desc) + "</p>" : "") + "</div></div>" +
          '<div class="mat-list">' + itens.map(linhaMaterial).join("") + "</div></section>";
      }).join("") : '<div class="empty">O material de apoio está sendo preparado.</div>')
    );
    document.querySelectorAll("#conteudo [data-ler]").forEach(function (b) { b.addEventListener("click", function () { lerMaterial(b.getAttribute("data-ler")); }); });
    document.querySelectorAll("#conteudo [data-ir]").forEach(function (b) {
      b.addEventListener("click", function () { var el = $("sec-" + b.getAttribute("data-ir")); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); });
    });
  }

  // ---------- Minha conta ----------
  function telaConta() {
    render(
      '<div class="page-head"><p class="eyebrow">Seu acesso</p><h1>Minha conta<span class="dot">.</span></h1><p>Conta: <b>' + esc(st.user.email) + "</b></p></div>" +
      '<form class="panel" id="fConta" novalidate style="max-width:520px"><h3>Trocar senha</h3>' +
      '<label for="nSenha1">Nova senha</label><input id="nSenha1" type="password" autocomplete="new-password" minlength="8" placeholder="Mínimo de 8 caracteres">' +
      '<label for="nSenha2">Repita a nova senha</label><input id="nSenha2" type="password" autocomplete="new-password" minlength="8" placeholder="Digite a mesma senha">' +
      '<button class="btn gold" id="bTrocar" type="submit">Salvar nova senha</button><p class="msg" id="mConta" role="status"></p></form>'
    );
    $("fConta").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var a = $("nSenha1").value, c = $("nSenha2").value, out = $("mConta"), b = $("bTrocar");
      if (a.length < 8) { msg(out, "A senha precisa ter pelo menos 8 caracteres.", "err"); return; }
      if (a !== c) { msg(out, "As duas senhas não estão iguais.", "err"); return; }
      b.disabled = true; msg(out, "");
      var r = await sb.auth.updateUser({ password: a });
      b.disabled = false;
      if (r.error) { msg(out, /different from the old/i.test(r.error.message) ? "Essa já é a sua senha atual." : traduz(r.error), "err"); return; }
      $("nSenha1").value = ""; $("nSenha2").value = "";
      msg(out, "Senha atualizada.", "ok");
    });
  }

  // ---------- Administração ----------
  var adminAba = "afiliados";
  async function telaAdmin() {
    if (st.profile.role !== "admin") { location.hash = "inicio"; return; }
    render('<div class="page-head"><p class="eyebrow">Só para você</p><h1>Administração<span class="dot">.</span></h1><p>Afiliados, aulas e material da Área de Parceiros.</p></div>' +
      '<div class="chips">' + [["afiliados", "Afiliados"], ["aulas", "Aulas"], ["material", "Material"]].map(function (t) {
        return '<button class="chip' + (adminAba === t[0] ? " active" : "") + '" data-aba="' + t[0] + '">' + t[1] + "</button>";
      }).join("") + '</div><div id="adminCorpo"><div class="loader" style="margin:30px auto"></div></div>');
    document.querySelectorAll("[data-aba]").forEach(function (b) { b.addEventListener("click", function () { adminAba = b.getAttribute("data-aba"); telaAdmin(); }); });
    if (adminAba === "afiliados") await adminAfiliados();
    else if (adminAba === "aulas") adminAulas();
    else adminMaterial();
  }

  async function adminAfiliados() {
    var a = await sb.from("affiliates").select("user_id,status,slug,display_name,link_campus,link_circulo,created_at").order("created_at", { ascending: false });
    var ids = (a.data || []).map(function (x) { return x.user_id; });
    var p = ids.length ? await sb.from("profiles").select("id,email,full_name").in("id", ids) : { data: [] };
    var porId = {}; (p.data || []).forEach(function (x) { porId[x.id] = x; });
    var linhas = (a.data || []).map(function (x) {
      var pr = porId[x.user_id] || {};
      return "<tr><td><b>" + esc(pr.full_name || x.display_name || "—") + "</b><br><small>" + esc(pr.email || "") + "</small></td>" +
        "<td>" + (x.slug ? '<a href="/p/' + esc(x.slug) + '" target="_blank" rel="noopener">/p/' + esc(x.slug) + "</a>" : "<small>sem página</small>") + "</td>" +
        "<td>" + (x.link_campus ? '<span class="badge ok">Mensal</span> ' : "") + (x.link_circulo ? '<span class="badge ok">Vitalício</span>' : "") + (!x.link_campus && !x.link_circulo ? "<small>nenhum</small>" : "") + "</td>" +
        "<td><small>" + new Date(x.created_at).toLocaleDateString("pt-BR") + "</small></td>" +
        '<td><span class="badge ' + (x.status === "active" ? "ok" : "err") + '">' + (x.status === "active" ? "Ativo" : "Bloqueado") + "</span></td>" +
        '<td><button class="btn small ' + (x.status === "active" ? "danger" : "") + '" data-status="' + esc(x.user_id) + '" data-novo="' + (x.status === "active" ? "blocked" : "active") + '">' + (x.status === "active" ? "Bloquear" : "Reativar") + "</button></td></tr>";
    }).join("");
    $("adminCorpo").innerHTML = '<div class="panel"><p class="eyebrow">' + (a.data || []).length + ' afiliados</p>' +
      (linhas ? '<div class="table-wrap"><table><thead><tr><th>Afiliado</th><th>Página</th><th>Links</th><th>Desde</th><th>Status</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>" : '<div class="empty">Nenhum afiliado ainda.</div>') + "</div>";
    document.querySelectorAll("[data-status]").forEach(function (b) {
      b.addEventListener("click", async function () {
        var novo = b.getAttribute("data-novo");
        if (novo === "blocked" && !window.confirm("Bloquear este afiliado? A página dele sai do ar e o acesso à área é cortado.")) return;
        b.disabled = true;
        var r = await sb.rpc("admin_set_affiliate_status", { target_user_id: b.getAttribute("data-status"), new_status: novo });
        if (r.error) { b.disabled = false; toast("Não foi possível alterar."); return; }
        toast(novo === "blocked" ? "Afiliado bloqueado." : "Afiliado reativado.");
        adminAfiliados();
      });
    });
  }

  function adminAulas(edit) {
    var e = edit || {};
    var linhas = st.lessons.map(function (l) {
      return "<tr><td><small>" + esc(l.module) + " · " + l.position + "</small><br><b>" + esc(l.title) + "</b></td><td>" + (youtubeId(l.video_url) ? '<span class="badge ok">vídeo</span>' : '<span class="badge">sem vídeo</span>') + "</td>" +
        '<td><span class="badge ' + (l.active ? "ok" : "") + '">' + (l.active ? "Publicada" : "Oculta") + '</span></td><td><div class="row-actions"><button class="btn small" data-edit-aula="' + esc(l.id) + '">Editar</button><button class="btn small danger" data-del-aula="' + esc(l.id) + '">Excluir</button></div></td></tr>';
    }).join("");
    $("adminCorpo").innerHTML =
      '<form class="panel" id="fAula" novalidate><h3>' + (e.id ? "Editar aula" : "Nova aula") + '</h3><div class="form-grid">' +
      '<div><label for="aMod">Módulo</label><input id="aMod" type="text" maxlength="60" value="' + esc(e.module || "") + '" placeholder="01 · Conheça o que você vende" list="listaMods"><datalist id="listaMods">' + modulos().map(function (m) { return '<option value="' + esc(m) + '">'; }).join("") + "</datalist></div>" +
      '<div><label for="aPos">Ordem dentro do módulo</label><input id="aPos" type="number" min="0" value="' + esc(e.position == null ? st.lessons.length + 1 : e.position) + '"></div>' +
      '<div class="full"><label for="aTit">Título</label><input id="aTit" type="text" maxlength="120" value="' + esc(e.title || "") + '"></div>' +
      '<div class="full"><label for="aDesc">Descrição curta</label><input id="aDesc" type="text" maxlength="220" value="' + esc(e.description || "") + '"></div>' +
      '<div><label for="aVid">Link do YouTube (não listado)</label><input id="aVid" type="url" value="' + esc(e.video_url || "") + '" placeholder="https://youtu.be/…"></div>' +
      '<div><label for="aDur">Duração</label><input id="aDur" type="text" maxlength="20" value="' + esc(e.duration || "") + '" placeholder="5 min"></div>' +
      '<label class="check full"><input id="aAtiva" type="checkbox"' + (e.active === false ? "" : " checked") + "> <span>Publicada para os parceiros</span></label></div>" +
      '<button class="btn gold" type="submit">' + (e.id ? "Salvar aula" : "Adicionar aula") + "</button>" + (e.id ? '<button class="link" type="button" id="bCancelarAula">Cancelar edição</button>' : "") + '<p class="msg" id="mAula"></p></form>' +
      '<div class="panel">' + (linhas ? '<div class="table-wrap"><table><thead><tr><th>Aula</th><th>Vídeo</th><th>Status</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>" : '<div class="empty">Nenhuma aula cadastrada.</div>') + "</div>";
    if (e.id) $("bCancelarAula").addEventListener("click", function () { adminAulas(); });
    $("fAula").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var out = $("mAula");
      var d = { module: $("aMod").value.trim(), position: parseInt($("aPos").value, 10) || 0, title: $("aTit").value.trim(), description: $("aDesc").value.trim() || null, video_url: $("aVid").value.trim() || null, duration: $("aDur").value.trim() || null, active: $("aAtiva").checked };
      if (!d.module || !d.title) { msg(out, "Preencha módulo e título.", "err"); return; }
      if (d.video_url && !youtubeId(d.video_url)) { msg(out, "Use um link do YouTube (youtube.com ou youtu.be).", "err"); return; }
      var r = e.id ? await sb.from("affiliate_lessons").update(d).eq("id", e.id) : await sb.from("affiliate_lessons").insert(d);
      if (r.error) { msg(out, traduz(r.error), "err"); return; }
      await carregarConteudo(); toast(e.id ? "Aula salva." : "Aula adicionada."); adminAulas();
    });
    document.querySelectorAll("[data-edit-aula]").forEach(function (b) {
      b.addEventListener("click", function () { adminAulas(st.lessons.filter(function (x) { return x.id === b.getAttribute("data-edit-aula"); })[0]); window.scrollTo(0, 0); });
    });
    document.querySelectorAll("[data-del-aula]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!window.confirm("Excluir esta aula? O progresso dos parceiros nela também é apagado.")) return;
        var r = await sb.from("affiliate_lessons").delete().eq("id", b.getAttribute("data-del-aula"));
        if (r.error) { toast("Não foi possível excluir."); return; }
        await carregarConteudo(); toast("Aula excluída."); adminAulas();
      });
    });
  }

  function adminMaterial(edit) {
    var e = edit || {};
    var tipos = { link: "Link", file: "Arquivo para baixar", text: "Texto para copiar" };
    var linhas = st.materials.map(function (m) {
      var sec = SECOES.filter(function (x) { return x.id === secaoDe(m); })[0];
      return "<tr><td><small>" + m.position + " · " + esc(sec ? sec.titulo : "") + " · " + esc(tipos[m.kind] || m.kind) + "</small><br><b>" + esc(m.title) + "</b></td>" +
        '<td><span class="badge ' + (m.active ? "ok" : "") + '">' + (m.active ? "Publicado" : "Oculto") + '</span></td><td><div class="row-actions"><button class="btn small" data-edit-mat="' + esc(m.id) + '">Editar</button><button class="btn small danger" data-del-mat="' + esc(m.id) + '">Excluir</button></div></td></tr>';
    }).join("");
    $("adminCorpo").innerHTML =
      '<form class="panel" id="fMat" novalidate><h3>' + (e.id ? "Editar material" : "Novo material") + '</h3><div class="form-grid">' +
      '<div class="full"><label for="mTit">Título</label><input id="mTit" type="text" maxlength="120" value="' + esc(e.title || "") + '"></div>' +
      '<div><label for="mTipo">Tipo</label><select id="mTipo">' + Object.keys(tipos).map(function (k) { return '<option value="' + k + '"' + (e.kind === k ? " selected" : "") + ">" + tipos[k] + "</option>"; }).join("") + "</select></div>" +
      '<div><label for="mPos">Ordem</label><input id="mPos" type="number" min="0" value="' + esc(e.position == null ? st.materials.length + 1 : e.position) + '"></div>' +
      '<div><label for="mSec">Seção</label><select id="mSec">' + SECOES.map(function (x) { return '<option value="' + x.id + '"' + (secaoDe(e) === x.id ? " selected" : "") + ">" + esc(x.titulo) + "</option>"; }).join("") + "</select></div>" +
      '<div><label for="mRes">Resumo (uma linha na lista)</label><input id="mRes" type="text" maxlength="160" value="' + esc(e.summary || "") + '"></div>' +
      '<div class="full"><label for="mUrl">Link (para Link ou Arquivo)</label><input id="mUrl" type="url" value="' + esc(e.url || "") + '" placeholder="https://…"></div>' +
      '<div class="full"><label for="mBody">Texto (descrição, ou o texto pronto para copiar)</label><textarea id="mBody" maxlength="12000" style="min-height:220px">' + esc(e.body || "") + "</textarea></div>" +
      '<label class="check full"><input id="mAtivo" type="checkbox"' + (e.active === false ? "" : " checked") + "> <span>Publicado para os parceiros</span></label></div>" +
      '<button class="btn gold" type="submit">' + (e.id ? "Salvar material" : "Adicionar material") + "</button>" + (e.id ? '<button class="link" type="button" id="bCancelarMat">Cancelar edição</button>' : "") + '<p class="msg" id="mMat"></p></form>' +
      '<div class="panel">' + (linhas ? '<div class="table-wrap"><table><thead><tr><th>Material</th><th>Status</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>" : '<div class="empty">Nenhum material cadastrado.</div>') + "</div>";
    if (e.id) $("bCancelarMat").addEventListener("click", function () { adminMaterial(); });
    $("fMat").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      var out = $("mMat");
      var d = { title: $("mTit").value.trim(), kind: $("mTipo").value, position: parseInt($("mPos").value, 10) || 0, url: $("mUrl").value.trim() || null, body: $("mBody").value.trim() || null, active: $("mAtivo").checked, section: $("mSec").value, summary: $("mRes").value.trim() || null };
      if (!d.title) { msg(out, "Preencha o título.", "err"); return; }
      if (d.url && !/^https:\/\//.test(d.url)) { msg(out, "O link precisa começar com https://", "err"); return; }
      if (d.kind !== "text" && !d.url) { msg(out, "Para Link ou Arquivo, preencha o link.", "err"); return; }
      if (d.kind === "text" && !d.body) { msg(out, "Escreva o texto que o parceiro vai copiar.", "err"); return; }
      var salvar = function (x) { return e.id ? sb.from("affiliate_materials").update(x).eq("id", e.id) : sb.from("affiliate_materials").insert(x); };
      var r = await salvar(d);
      if (r.error && /section|summary/i.test(r.error.message || "")) { delete d.section; delete d.summary; r = await salvar(d); }
      if (r.error) { msg(out, traduz(r.error), "err"); return; }
      await carregarConteudo(); toast(e.id ? "Material salvo." : "Material adicionado."); adminMaterial();
    });
    document.querySelectorAll("[data-edit-mat]").forEach(function (b) {
      b.addEventListener("click", function () { adminMaterial(st.materials.filter(function (x) { return x.id === b.getAttribute("data-edit-mat"); })[0]); window.scrollTo(0, 0); });
    });
    document.querySelectorAll("[data-del-mat]").forEach(function (b) {
      b.addEventListener("click", async function () {
        if (!window.confirm("Excluir este material?")) return;
        var r = await sb.from("affiliate_materials").delete().eq("id", b.getAttribute("data-del-mat"));
        if (r.error) { toast("Não foi possível excluir."); return; }
        await carregarConteudo(); toast("Material excluído."); adminMaterial();
      });
    });
  }

  // ---------- início ----------
  if (!window.supabase || !cfg.url || !cfg.anonKey) {
    views("vEntrar");
    msg($("mLogin"), "Não foi possível carregar agora. Atualize a página em alguns segundos.", "err");
    return;
  }
  sb = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: "pkce" }
  });
  sb.auth.onAuthStateChange(function (evento) { if (evento === "SIGNED_OUT") views("vEntrar"); });
  if (/cadastro/.test(location.hash)) abaAuth("cadastro");
  carregar();
})();

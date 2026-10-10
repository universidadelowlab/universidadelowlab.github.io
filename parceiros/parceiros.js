(function () {
  "use strict";

  var cfg = window.LOWLAB_SUPABASE || {};
  var $ = function (id) { return document.getElementById(id); };
  var SITE = location.origin;
  var SITE_CURTO = SITE.replace(/^https?:\/\//, "");
  var FN_CADASTRO = (cfg.url || "") + "/functions/v1/affiliate-signup";
  var LINK_CAKTO = /^https:\/\/pay\.cakto\.com\.br\/[^\s"'<>]+$/;
  var APELIDO = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
  var RESERVADOS = ["admin", "lowlab", "parceiros", "campus", "acesso", "suporte", "oficial", "circulo"];
  var PLANOS = [
    // o campo link_circulo guarda o link do plano Vitalício (nome mantido no banco)
    { id: "campus", nome: "Mensal", cakto: "LowLab Campus", preco: 297, periodo: "/mês", campo: "link_campus", ganho: "por mês, enquanto o aluno assinar", convite: "https://app.cakto.com.br/affiliate/invite/826bce51-e635-4962-9612-199ddb91c440" },
    { id: "circulo", nome: "Vitalício", cakto: "LowLab Vitalício", preco: 597, periodo: " (pagamento único)", campo: "link_circulo", ganho: "por venda", convite: "https://app.cakto.com.br/affiliate/invite/b5a0b23f-83ae-47c1-9930-88a39b47f107" }
  ];
  // Comissão: 50% do valor da venda depois da taxa da Cakto (tabela de setembro de 2026).
  var COMISSAO = 0.5;
  var TAXAS = { pix: { pct: 0, fixo: 2.49, nome: "Pix" }, cartao: { pct: 0.0499, fixo: 2.49, nome: "Cartão" } };
  var CAKTO = "https://app.cakto.com.br/";
  var SUPORTE = "universidadelowlab@gmail.com";
  // Convite do grupo de WhatsApp dos parceiros. Vazio = a tarefa pede o convite por e-mail.
  var GRUPO_WHATSAPP = "";
  var COLS_AFF = "user_id,status,slug,display_name,link_campus,link_circulo,created_at";
  var VISTAS = ["inicio", "pagina", "aulas", "material", "conta", "admin"];
  var ICO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var ICO_TEMPO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';

  var sb = null;
  var st = {
    user: null, profile: null, aff: null, lessons: [], done: new Set(), materials: [], filtro: "todos",
    ck: {}, ckBanco: false, abertas: null, sujo: false, antesModal: null, calc: { m: 0, v: 0, forma: "pix" }
  };

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
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }
  // marcas antigas guardadas só no navegador (convites clicados antes da jornada)
  function marca(k) { try { return localStorage.getItem("ll_parc_" + k) === "1"; } catch (e) { return false; } }
  function ehAdmin() { return !!(st.profile && st.profile.role === "admin" && st.profile.status === "active"); }
  function botoesConvite(classe) {
    return PLANOS.map(function (p) {
      return '<a class="btn small' + (classe || "") + '" href="' + esc(p.convite) + '" target="_blank" rel="noopener" data-convite="' + p.id + '">Afiliar ao ' + esc(p.nome) + " ↗</a>";
    }).join("");
  }
  function ligarConvites() {
    document.querySelectorAll("#conteudo [data-convite]").forEach(function (a) {
      a.addEventListener("click", function () { setCk("conv_" + a.getAttribute("data-convite"), true); });
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
  function liquido(preco, forma) { var t = TAXAS[forma]; return preco - (preco * t.pct + t.fixo); }
  // arredonda para baixo (centavo), para nunca mostrar mais do que a Cakto paga
  function comissaoDe(preco, forma) { return Math.floor(liquido(preco, forma) * COMISSAO * 100 + 1e-6) / 100; }
  function vistaAtual() { return (location.hash.slice(1) || "inicio").split("/")[0]; }
  function matKey(k) { return st.materials.filter(function (m) { return m.key === k && m.active; })[0] || null; }

  // ---------- progresso da jornada (salvo na conta; sem conta de parceiro, só neste navegador) ----------
  function chaveLocal() { return "ll_parc_ck_" + (st.user ? st.user.id : "anon"); }
  function lerCkLocal() {
    try { var v = JSON.parse(localStorage.getItem(chaveLocal()) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch (e) { return {}; }
  }
  function gravarCkLocal() { try { localStorage.setItem(chaveLocal(), JSON.stringify(st.ck)); } catch (e) {} }
  function carregarCk() {
    st.ckBanco = !!(st.aff && Object.prototype.hasOwnProperty.call(st.aff, "checklist"));
    var base = st.ckBanco ? st.aff.checklist : lerCkLocal();
    st.ck = {};
    if (base && typeof base === "object" && !Array.isArray(base)) Object.keys(base).forEach(function (k) { if (base[k]) st.ck[k] = 1; });
    var novo = false;
    PLANOS.forEach(function (p) { if (marca("conv_" + p.id) && !st.ck["conv_" + p.id]) { st.ck["conv_" + p.id] = 1; novo = true; } });
    if (novo) salvarCk();
  }
  var ckTimer = 0, ckAvisou = false;
  function salvarCk() {
    gravarCkLocal();
    if (!st.ckBanco) return;
    clearTimeout(ckTimer);
    ckTimer = setTimeout(async function () {
      var r = await sb.from("affiliates").update({ checklist: st.ck }).eq("user_id", st.user.id).select("user_id").maybeSingle();
      if (r.error || !r.data) {
        if (!ckAvisou) { ckAvisou = true; toast("Não deu para salvar seu progresso na conta agora. Ele ficou guardado neste navegador."); }
        return;
      }
      st.aff.checklist = JSON.parse(JSON.stringify(st.ck));
    }, 500);
  }
  function setCk(k, ligado) {
    if (ligado) { if (st.ck[k]) return false; st.ck[k] = 1; }
    else { if (!st.ck[k]) return false; delete st.ck[k]; }
    salvarCk();
    return true;
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
  function abrirModal(html) { $("modalCorpo").innerHTML = html; $("modal").hidden = false; $("modal").querySelector(".modal-box").scrollTop = 0; }
  function fecharModal() {
    $("modal").hidden = true; $("modalCorpo").innerHTML = "";
    if (!st.sujo) return;
    st.sujo = false;
    var v = vistaAtual();
    if (v === "inicio") depoisDeMudar(st.antesModal || etapasFeitas());
    else if (v === "material") telaMaterial(true);
  }

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
    var a = await sb.from("affiliates").select(COLS_AFF + ",checklist").eq("user_id", sess.user.id).maybeSingle();
    if (a.error) a = await sb.from("affiliates").select(COLS_AFF).eq("user_id", sess.user.id).maybeSingle();
    st.aff = a.data || null;
    var admin = ehAdmin();
    if (!st.aff && !admin) { $("npEmail").textContent = sess.user.email; views("vNaoParceiro"); return; }
    if (st.aff && st.aff.status === "blocked" && !admin) { views("vBloqueado"); return; }
    carregarCk();
    await carregarConteudo();
    $("whoNome").textContent = (st.profile.full_name || st.aff && st.aff.display_name || "Parceiro");
    $("whoEmail").textContent = sess.user.email;
    $("navAdmin").hidden = !admin;
    // a página de aulas só aparece quando houver aula publicada (o admin sempre vê, para cadastrar)
    document.querySelector('[data-nav="aulas"]').hidden = !admin && !st.lessons.some(function (x) { return x.active; });
    views("vApp");
    rota();
  }

  async function carregarConteudo() {
    var l = await sb.from("affiliate_lessons").select("id,module,position,title,description,video_url,duration,active").order("module").order("position");
    st.lessons = (l.data || []).filter(function (x) { return x.active || ehAdmin(); });
    var d = await sb.from("affiliate_progress").select("lesson_id").eq("user_id", st.user.id);
    st.done = new Set((d.data || []).map(function (x) { return x.lesson_id; }));
    var m = await sb.from("affiliate_materials").select("id,position,title,kind,body,url,active,section,summary,key").order("position");
    if (m.error) m = await sb.from("affiliate_materials").select("id,position,title,kind,body,url,active,section,summary").order("position");
    if (m.error) m = await sb.from("affiliate_materials").select("id,position,title,kind,body,url,active").order("position");
    st.materials = (m.data || []).filter(function (x) { return x.active || ehAdmin(); });
  }

  // ---------- rotas ----------
  window.addEventListener("hashchange", rota);
  function rota() {
    if ($("vApp").hidden) return;
    var v = vistaAtual();
    if (VISTAS.indexOf(v) < 0) v = "inicio";
    if (v === "admin" && !ehAdmin()) v = "inicio";
    if (v === "aulas" && document.querySelector('[data-nav="aulas"]').hidden) v = "inicio";
    document.querySelectorAll("[data-nav]").forEach(function (a) { a.classList.toggle("active", a.getAttribute("data-nav") === v); });
    $("side").classList.remove("open");
    var f = { inicio: telaInicio, pagina: telaPagina, aulas: telaAulas, material: telaMaterial, conta: telaConta, admin: telaAdmin }[v];
    f();
    window.scrollTo(0, 0);
  }
  function render(html) { $("conteudo").innerHTML = html; $("conteudo").focus({ preventScroll: true }); }
  function ligarCopiar() {
    document.querySelectorAll("#conteudo [data-copiar]").forEach(function (b) { b.addEventListener("click", function () { copiar(b.getAttribute("data-copiar")); }); });
  }

  // ---------- Jornada do parceiro (Meu espaço) ----------
  // Cada tarefa: o que fazer (desc), como fazer (passos), quando está pronta (pronto) e os atalhos (acoes).
  // auto(a, ck): conclui sozinha (dados da página ou material aberto). soAuto: não dá para marcar à mão.
  function lido(k) { return function (a, ck) { return !!ck["m_" + k]; }; }
  var JORNADA = [
    {
      id: "e1", titulo: "Boas-vindas à parceria", tempo: "15 min",
      sub: "Entenda como a parceria funciona, quanto você ganha e o que pode e não pode fazer.",
      tarefas: [
        {
          id: "guia", titulo: "Leia o guia de boas-vindas", tempo: "5 min",
          auto: lido("boas_vindas"), autoTxt: "Marca sozinha quando você abrir o guia.",
          desc: "O que você vende, quanto ganha em cada venda, quando recebe e o caminho das 8 etapas.",
          passos: [
            "Abra o guia e leia até o fim.",
            "Entenda a conta da comissão: a Cakto desconta a taxa dela e metade do que sobra é sua.",
            "Guarde a regra do cookie: ele vale por 30 dias, e a venda é de quem teve o último clique."
          ],
          pronto: "Você sabe dizer quanto ganha numa venda do Mensal e numa do Vitalício.",
          acoes: [{ t: "mat", k: "boas_vindas", l: "Ler o guia" }]
        },
        {
          id: "regras", titulo: "Leia e assuma as regras de divulgação", tempo: "5 min",
          auto: lido("regras"), autoTxt: "Marca sozinha quando você abrir as regras.",
          desc: "São 5 regras. Quem descumpre recebe uma advertência e, na segunda vez, sai do programa.",
          passos: [
            "Nunca prometa ganho, renda ou prazo de resultado.",
            "Não use “LowLab” no nome do perfil, no @, em página ou em domínio seu. Na bio, pode escrever “afiliado LowLab”.",
            "Sem spam, sem dados de alunos e sem número de resultado além do oficial."
          ],
          pronto: "Você leu as regras inteiras e sabe o que nunca dizer.",
          acoes: [{ t: "mat", k: "regras", l: "Ler as regras" }]
        },
        {
          id: "grupo", titulo: "Entre no grupo dos parceiros", tempo: "2 min",
          desc: "Avisos, materiais novos e dúvidas rápidas ficam no grupo de WhatsApp dos parceiros.",
          passos: GRUPO_WHATSAPP
            ? ["Toque em Entrar no grupo e confirme no WhatsApp.", "Apresente-se: seu nome, sua cidade e em que rede você vai divulgar."]
            : ["Peça o convite do grupo para quem te apresentou a parceria ou pelo e-mail do suporte.", "Ao entrar, apresente-se: seu nome, sua cidade e em que rede você vai divulgar."],
          pronto: "Você está no grupo e se apresentou.",
          acoes: GRUPO_WHATSAPP
            ? [{ t: "ext", u: GRUPO_WHATSAPP, l: "Entrar no grupo" }]
            : [{ t: "mail", assunto: "Convite do grupo de parceiros", l: "Pedir o convite por e-mail" }]
        }
      ]
    },
    {
      id: "e2", titulo: "Afiliação na Cakto", tempo: "20 min",
      sub: "Crie sua conta de recebimento e peça a afiliação nos dois planos. A aprovação é automática.",
      tarefas: [
        {
          id: "conta_cakto", titulo: "Crie sua conta de recebimento na Cakto", tempo: "10 min",
          desc: "É pela Cakto que as vendas ficam registradas no seu nome e que a comissão é paga.",
          passos: [
            "Crie a conta na Cakto com os seus dados e o seu CPF. Se já tiver conta, use a mesma.",
            "Em Financeiro, cadastre a conta bancária ou a chave Pix onde você quer receber.",
            "Se a Cakto pedir verificação de identidade, faça agora: sem ela, o saque pode travar."
          ],
          pronto: "Seus dados e a conta bancária estão completos na Cakto.",
          acoes: [{ t: "ext", u: CAKTO, l: "Abrir a Cakto" }, { t: "mat", k: "afiliacao", l: "Ver o passo a passo" }]
        },
        {
          id: "conv_campus", titulo: "Afilie-se ao plano Mensal", tempo: "2 min",
          auto: function (a) { return !!(a && a.link_campus); }, autoTxt: "Marca sozinha quando você clicar em Afiliar ao Mensal.",
          desc: "Na Cakto, o Mensal se chama LowLab Campus. Comissão: cerca de R$\u00a0147 por mês no Pix, enquanto o aluno assinar.",
          passos: ["Toque em Afiliar ao Mensal e entre com a sua conta da Cakto.", "Confirme o pedido de afiliação. A aprovação é automática."],
          pronto: "O LowLab Campus aparece em Produtos › Minhas Afiliações.",
          acoes: [{ t: "convite", p: "campus" }]
        },
        {
          id: "conv_circulo", titulo: "Afilie-se ao plano Vitalício", tempo: "2 min",
          auto: function (a) { return !!(a && a.link_circulo); }, autoTxt: "Marca sozinha quando você clicar em Afiliar ao Vitalício.",
          desc: "Na Cakto, o produto se chama LowLab Vitalício. Comissão: cerca de R$\u00a0297 por venda no Pix.",
          passos: ["Toque em Afiliar ao Vitalício e entre com a sua conta da Cakto.", "Confirme o pedido de afiliação. A aprovação é automática."],
          pronto: "O LowLab Vitalício aparece em Produtos › Minhas Afiliações.",
          acoes: [{ t: "convite", p: "circulo" }]
        },
        {
          id: "copiar_links", titulo: "Copie seus dois links de afiliado", tempo: "3 min",
          auto: function (a) { return !!(a && a.link_campus && a.link_circulo); }, autoTxt: "Marca sozinha quando os dois links estiverem salvos na sua página.",
          desc: "São esses links que registram a venda no seu nome.",
          passos: [
            "Na Cakto, abra Produtos › Minhas Afiliações.",
            "No LowLab Campus, clique em Ver Links e copie o link completo. Faça o mesmo no LowLab Vitalício.",
            "Confira: os dois começam com https://pay.cakto.com.br/."
          ],
          pronto: "Você tem os dois links copiados, num bloco de notas, por exemplo.",
          acoes: [{ t: "ext", u: CAKTO, l: "Abrir a Cakto" }]
        }
      ]
    },
    {
      id: "e3", titulo: "Sua página de vendas", tempo: "10 min",
      sub: "Monte o seu endereço " + SITE_CURTO + "/p/seu-apelido, com os botões de compra nos seus links.",
      tarefas: [
        {
          id: "apelido", titulo: "Escolha seu apelido", tempo: "2 min", soAuto: true,
          auto: function (a) { return !!(a && a.slug); }, autoTxt: "Marca sozinha quando você salvar a página com o apelido.",
          desc: "Ele vira o seu endereço: curto, fácil de falar na live e de digitar.",
          passos: [
            "Abra Minha página de vendas.",
            "Escreva como quer aparecer em “Você chegou por indicação de…”.",
            "Escolha o apelido: letras minúsculas, números e hífen, como ana-souza."
          ],
          pronto: "Seu endereço aparece em Minha página de vendas.",
          acoes: [{ t: "nav", h: "#pagina", l: "Configurar minha página" }]
        },
        {
          id: "links", titulo: "Cole os links e salve a página", tempo: "3 min", soAuto: true,
          auto: function (a) { return !!(a && a.link_campus && a.link_circulo); }, autoTxt: "Marca sozinha quando os dois links estiverem salvos.",
          desc: "Cada plano só aparece na sua página depois que o link dele estiver salvo.",
          passos: ["Cole o link do Mensal (LowLab Campus) e o do Vitalício nos campos certos.", "Clique em Salvar minha página."],
          pronto: "Os dois links estão salvos.",
          acoes: [{ t: "nav", h: "#pagina", l: "Colar meus links" }]
        },
        {
          id: "teste", titulo: "Teste sua página como um cliente", tempo: "5 min",
          desc: "Antes de divulgar, confira se tudo leva para os seus links.",
          passos: [
            "Abra o seu endereço numa aba anônima ou no celular de outra pessoa.",
            "Confira se aparece “Você chegou por indicação de” com o seu nome.",
            "Clique nos dois botões de compra: cada um abre o checkout da Cakto do plano certo. Não finalize a compra."
          ],
          pronto: "Os dois botões abrem o checkout do plano certo.",
          acoes: function (a) {
            return a && a.slug
              ? [{ t: "ext", u: SITE + "/p/" + a.slug, l: "Abrir minha página" }, { t: "copiar", x: SITE + "/p/" + a.slug, l: "Copiar endereço" }]
              : [{ t: "nav", h: "#pagina", l: "Configurar minha página" }];
          }
        }
      ]
    },
    {
      id: "e4", titulo: "Conheça o que você vende", tempo: "40 min",
      sub: "Quem conhece o produto vende sem decorar texto: o pitch, a plataforma, o case e as objeções.",
      tarefas: [
        {
          id: "pitch", titulo: "Aprenda o pitch de 30 segundos", tempo: "10 min",
          auto: lido("lowlab5"), autoTxt: "Marca sozinha quando você abrir A LowLab em 5 minutos.",
          desc: "O que é a LowLab, quem está por trás, para quem é e para quem não é, e a diferença entre os planos.",
          passos: [
            "Leia “A LowLab em 5 minutos”.",
            "Decore o pitch de 30 segundos e a pergunta que decide: “Você quer testar ou já decidiu levar a sério?”.",
            "Fale o pitch em voz alta 3 vezes, sem ler."
          ],
          pronto: "Você fala o pitch sem ler.",
          acoes: [{ t: "mat", k: "lowlab5", l: "Ler A LowLab em 5 minutos" }]
        },
        {
          id: "tour", titulo: "Faça o tour pela plataforma", tempo: "15 min",
          auto: lido("tour"), autoTxt: "Marca sozinha quando você abrir o tour.",
          desc: "Entre no campus com esta mesma conta, em modo demonstração. É o que você vai mostrar nas lives.",
          passos: [
            "Abra o campus e veja os 13 módulos.",
            "Entre no módulo 1 e abra a aula 1, “A lógica do low ticket lucrativo”.",
            "Abra o Plano 30 dias e veja os três marcos.",
            "No tour, leia como mostrar a plataforma em 5 minutos."
          ],
          pronto: "Você mostra a plataforma em 5 minutos.",
          acoes: [{ t: "campus", l: "Abrir o campus" }, { t: "mat", k: "tour", l: "Ler o tour" }]
        },
        {
          id: "bruno", titulo: "Domine o case oficial do Bruno", tempo: "5 min",
          auto: lido("bruno"), autoTxt: "Marca sozinha quando você abrir o case.",
          desc: "É o único número de resultado que você pode usar, sempre com o texto oficial e o aviso de resultado individual.",
          passos: [
            "Leia o texto oficial e use exatamente como está.",
            "Fale “faturamento”, nunca “lucro”.",
            "Junto do número, sempre: “é resultado individual e depende de execução”."
          ],
          pronto: "Você conta o case com o aviso, sem mudar o número.",
          acoes: [{ t: "mat", k: "bruno", l: "Ler o case" }]
        },
        {
          id: "objecoes", titulo: "Treine as respostas às objeções", tempo: "10 min",
          auto: lido("objecoes"), autoTxt: "Marca sozinha quando você abrir as respostas.",
          desc: "As 18 dúvidas que mais aparecem no direct e na live, com respostas curtas.",
          passos: [
            "Leia as respostas em voz alta até sair natural.",
            "Treine as 5 mais comuns: preço, Mensal ou Vitalício, iniciante, anúncio e “é pirâmide?”."
          ],
          pronto: "Você responde as 5 mais comuns sem olhar.",
          acoes: [{ t: "mat", k: "objecoes", l: "Ler as respostas" }]
        }
      ]
    },
    {
      id: "e5", titulo: "Perfil pronto para vender", tempo: "30 min",
      sub: "Quem chega no seu perfil precisa entender em 3 segundos o que você faz e onde clicar.",
      tarefas: [
        {
          id: "perfil", titulo: "Ajuste nome, foto e conta profissional", tempo: "10 min",
          desc: "No Instagram e no TikTok. Sem “LowLab” no nome do perfil nem no @.",
          passos: [
            "Nome: o seu nome e o tema, como “Ana Souza | Low ticket na prática”.",
            "Foto: o seu rosto, de frente, com luz boa e fundo limpo.",
            "Instagram: em Tipo de conta, mude para conta profissional (Criador de conteúdo)."
          ],
          pronto: "Instagram e TikTok com nome, foto e conta profissional.",
          acoes: [{ t: "mat", k: "perfil", l: "Ver o checklist do perfil" }]
        },
        {
          id: "bio", titulo: "Cole a sua bio", tempo: "5 min",
          desc: "A bio abaixo já vem com o seu endereço. Prefere outra versão? Veja as 3 da Bio pronta.",
          extra: function (a) { return fmtSnip(bioPronta(a)); },
          passos: [
            "Copie a bio e cole no Instagram, no TikTok e nas outras redes.",
            "Se a rede ainda não deixar o link clicável, deixe o endereço escrito e mande o link no direct quando pedirem."
          ],
          pronto: "A bio está igual em todas as redes.",
          acoes: [{ t: "mat", k: "bio", l: "Ver as 3 versões" }]
        },
        {
          id: "link_bio", titulo: "Coloque o link da sua página no perfil", tempo: "5 min",
          desc: "É para lá que você manda todo mundo: “o link está na minha bio”.",
          passos: [
            "Instagram: Editar perfil › Links › Adicionar link externo.",
            "TikTok: Editar perfil › Site. Se a opção ainda não aparecer, deixe o endereço escrito na bio.",
            "Teste o link no celular de outra pessoa."
          ],
          pronto: "O link abre a sua página nas duas redes.",
          acoes: function (a) {
            return a && a.slug ? [{ t: "copiar", x: SITE + "/p/" + a.slug, l: "Copiar meu link" }] : [{ t: "nav", h: "#pagina", l: "Configurar minha página" }];
          }
        },
        {
          id: "whats", titulo: "Deixe o WhatsApp pronto", tempo: "10 min",
          desc: "Respostas rápidas salvas economizam horas por semana.",
          passos: [
            "Use o WhatsApp Business e coloque o link da sua página no perfil comercial.",
            "Salve as mensagens prontas como respostas rápidas: o que é, link, preço e comprei."
          ],
          pronto: "As respostas rápidas estão salvas.",
          acoes: [{ t: "mat", k: "mensagens", l: "Ver mensagens prontas" }]
        }
      ]
    },
    {
      id: "e6", titulo: "Seus primeiros conteúdos", tempo: "7 dias, cerca de 1h por dia",
      sub: "Dois vídeos curtos por dia durante 7 dias: é o que traz gente nova para o seu perfil todos os dias.",
      tarefas: [
        {
          id: "plano7", titulo: "Planeje os seus 7 primeiros dias", tempo: "15 min",
          desc: "O plano dia a dia, com os 2 vídeos e o status do WhatsApp de cada dia.",
          passos: ["Leia o plano dos 7 dias.", "Anote na agenda os 14 vídeos, com o gancho de cada um."],
          pronto: "Os 14 vídeos estão anotados na sua agenda.",
          acoes: [{ t: "mat", k: "sete_dias", l: "Ver o plano de 7 dias" }, { t: "mat", k: "ganchos", l: "Ver os 12 ganchos" }]
        },
        {
          id: "videos3", titulo: "Grave e poste os 3 primeiros vídeos", tempo: "1h",
          desc: "Estrutura de 30 segundos: gancho em 2 segundos, o ponto em 20 e a chamada em 5.",
          passos: [
            "Grave na vertical, com luz de frente e o celular na altura dos olhos.",
            "Comece direto pelo gancho e termine com “o link está na minha bio”.",
            "Poste o mesmo vídeo no TikTok, no Reels e no Shorts."
          ],
          pronto: "3 vídeos no ar nas três redes.",
          acoes: [{ t: "mat", k: "ganchos", l: "Ver ganchos e roteiro" }]
        },
        {
          id: "responder", titulo: "Responda todo comentário e direct", tempo: "20 min por dia",
          desc: "Quem pergunta está perto de comprar. Responda no mesmo dia, com as mensagens prontas.",
          passos: [
            "Responda todos os comentários dos seus vídeos.",
            "Quem perguntar o que é ou quanto custa recebe a mensagem pronta e, se pedir, o link da sua página.",
            "Retomada, uma vez só, 2 ou 3 dias depois. Sem insistir."
          ],
          pronto: "Nenhum comentário ou direct fica sem resposta.",
          acoes: [{ t: "mat", k: "mensagens", l: "Ver mensagens prontas" }]
        },
        {
          id: "semana1", titulo: "Feche a primeira semana", tempo: "15 min",
          desc: "14 vídeos postados e a revisão do dia 7.",
          passos: [
            "Confira se postou 2 vídeos por dia nos 7 dias.",
            "Veja quais vídeos tiveram mais comentários e perguntas.",
            "Repita esses temas na semana 2."
          ],
          pronto: "Você sabe quais temas mais funcionaram.",
          acoes: [{ t: "mat", k: "sete_dias", l: "Ver o plano de 7 dias" }]
        }
      ]
    },
    {
      id: "e7", titulo: "Sua primeira live", tempo: "2h com a preparação",
      sub: "Na live, a confiança vira venda: você ensina ao vivo, mostra a plataforma e tira as dúvidas na hora.",
      tarefas: [
        {
          id: "live_ok", titulo: "Confira se a sua live está liberada", tempo: "2 min",
          desc: "No TikTok, a live depende da conta: algumas liberam com 50 seguidores, outras só com 1.000.",
          passos: [
            "No TikTok, toque em + e veja se aparece a opção LIVE.",
            "Ainda não apareceu? Faça a live no Instagram, que não exige número mínimo de seguidores, e continue os vídeos até liberar no TikTok."
          ],
          pronto: "Você sabe em qual rede vai fazer a primeira live.",
          acoes: [{ t: "mat", k: "live_checklist", l: "Abrir o checklist da live" }]
        },
        {
          id: "live_setup", titulo: "Monte o cenário e anuncie o horário", tempo: "30 min",
          desc: "Celular firme, luz de frente, som limpo e um horário fixo que o seu público aprende.",
          passos: [
            "Celular na vertical, num tripé, na altura dos olhos. Luz de frente, nunca de costas para a janela.",
            "Fone com microfone, internet estável e celular carregando.",
            "Escolha dia e horário fixos (por exemplo, de segunda a sexta, às 20h) e avise na bio e nos stories."
          ],
          pronto: "Cenário testado com um vídeo de 10 segundos e horário anunciado.",
          acoes: [{ t: "mat", k: "live_checklist", l: "Abrir o checklist da live" }]
        },
        {
          id: "live_ensaio", titulo: "Ensaie o roteiro de 60 minutos", tempo: "30 min",
          desc: "O roteiro diz o que falar e o que mostrar em cada bloco, minuto a minuto.",
          passos: [
            "Leia o roteiro inteiro uma vez.",
            "Ensaie em voz alta a abertura, o bloco da LowLab e o fechamento.",
            "Decore a frase de afiliado: “Eu sou afiliado da LowLab: se você entrar pelo link da minha bio, eu ganho uma comissão e você paga o mesmo preço.”"
          ],
          pronto: "Você faz a abertura e o fechamento sem ler.",
          acoes: [{ t: "mat", k: "live_roteiro", l: "Abrir o roteiro" }]
        },
        {
          id: "live_chat", titulo: "Prepare as respostas do chat", tempo: "10 min",
          auto: function (a, ck) { return !!(ck.m_live_chat && ck.m_live_nunca); }, autoTxt: "Marca sozinha quando você abrir os dois materiais.",
          desc: "As perguntas que mais aparecem na live e as frases que tiram você do programa.",
          passos: ["Leia as respostas rápidas para o chat.", "Leia o que nunca dizer na live e as frases para usar no lugar."],
          pronto: "Você leu os dois materiais.",
          acoes: [{ t: "mat", k: "live_chat", l: "Respostas para o chat" }, { t: "mat", k: "live_nunca", l: "O que nunca dizer" }]
        },
        {
          id: "live1", titulo: "Faça a sua primeira live", tempo: "30 a 60 min",
          desc: "Ensine de verdade: monte uma oferta ao vivo com o chat e mostre onde você aprendeu.",
          passos: [
            "30 minutos antes: avise nos stories, ative o Não perturbe e teste câmera e som.",
            "Ao começar, fixe o comentário: “Sou afiliado da LowLab. O link está na minha bio.”",
            "Siga o roteiro e fale do link no máximo 3 vezes: no bloco da LowLab, nas objeções e no fechamento."
          ],
          pronto: "Live feita do começo ao fim, com a frase de afiliado.",
          acoes: [{ t: "mat", k: "live_roteiro", l: "Abrir o roteiro" }]
        },
        {
          id: "pos_live", titulo: "Aproveite a live depois que ela acabar", tempo: "40 min",
          desc: "Uma live rende conteúdo para a semana inteira.",
          passos: [
            "Responda todos os directs no mesmo dia.",
            "Anote o pico de pessoas, os novos seguidores, as perguntas que mais apareceram e as vendas do dia na Cakto.",
            "Corte os 3 melhores momentos no Opus Clip e programe para os próximos dias."
          ],
          pronto: "Directs respondidos, números anotados e 3 cortes prontos.",
          acoes: [{ t: "mat", k: "opus", l: "Como fazer cortes" }]
        }
      ]
    },
    {
      id: "e8", titulo: "Rotina de parceiro", tempo: "1h30 a 2h30 por dia",
      sub: "A venda vem da constância: vídeos todo dia, lives no mesmo horário e uma revisão por semana.",
      tarefas: [
        {
          id: "agenda", titulo: "Monte a sua agenda da semana", tempo: "30 min",
          desc: "Horário fixo para gravar, postar, responder e fazer live.",
          passos: [
            "Leia a rotina da semana.",
            "Coloque na agenda: 2 vídeos por dia, 20 minutos de respostas e as 5 lives da semana, sempre no mesmo horário.",
            "Toda segunda, escolha os 14 ganchos da semana."
          ],
          pronto: "A semana está na agenda, com horário para cada coisa.",
          acoes: [{ t: "mat", k: "rotina", l: "Ver a rotina da semana" }]
        },
        {
          id: "sexta", titulo: "Faça a primeira revisão de sexta", tempo: "20 min",
          desc: "Descubra o que trouxe as suas vendas e faça mais disso.",
          passos: [
            "Na Cakto, veja as vendas e as comissões da semana.",
            "Anote qual vídeo, live ou mensagem trouxe cada venda.",
            "Repita o que funcionou e troque o que não trouxe nenhuma conversa."
          ],
          pronto: "Você sabe o que trouxe as vendas da semana.",
          acoes: [{ t: "ext", u: CAKTO, l: "Abrir a Cakto" }, { t: "mat", k: "rotina", l: "Ver a rotina" }]
        },
        {
          id: "compartilhar", titulo: "Conte no grupo o que funcionou", tempo: "5 min",
          desc: "Um gancho que deu certo, uma objeção nova, uma dúvida: o grupo cresce junto.",
          passos: [
            "Poste no grupo dos parceiros o que mais funcionou na sua semana.",
            "Leia o que os outros parceiros contaram e teste uma ideia na semana seguinte."
          ],
          pronto: "Você contou no grupo o que funcionou.",
          acoes: GRUPO_WHATSAPP ? [{ t: "ext", u: GRUPO_WHATSAPP, l: "Abrir o grupo" }] : []
        }
      ]
    }
  ];

  function acoesDe(t, a) { return typeof t.acoes === "function" ? t.acoes(a) : (t.acoes || []); }
  function tarefaAuto(t, a, ck) { return !!(t.auto && t.auto(a, ck)); }
  function tarefaFeita(t, a, ck) { return !!ck[t.id] || tarefaAuto(t, a, ck); }
  function etapaFeita(e, a, ck) { return e.tarefas.every(function (t) { return tarefaFeita(t, a, ck); }); }
  function etapasFeitas() { return JORNADA.map(function (e) { return etapaFeita(e, st.aff, st.ck); }); }
  function progresso(a, ck) {
    var total = 0, feitas = 0, atual = -1;
    JORNADA.forEach(function (e, i) {
      var f = e.tarefas.filter(function (t) { return tarefaFeita(t, a, ck); }).length;
      total += e.tarefas.length; feitas += f;
      if (atual < 0 && f < e.tarefas.length) atual = i;
    });
    return { total: total, feitas: feitas, atual: atual };
  }
  function bioPronta(a) { return "Low ticket na prática | afiliado LowLab\n" + SITE_CURTO + "/p/" + ((a && a.slug) || "seu-apelido"); }

  function acaoHtml(x, destaque) {
    var cls = "btn small" + (destaque ? " gold" : "");
    if (x.t === "mat") {
      var m = matKey(x.k);
      return m ? '<button class="' + cls + '" type="button" data-ler="' + esc(m.id) + '">' + esc(x.l) + "</button>" : "";
    }
    if (x.t === "nav") return '<a class="' + cls + '" href="' + esc(x.h) + '">' + esc(x.l) + "</a>";
    if (x.t === "ext") return '<a class="' + cls + '" href="' + esc(x.u) + '" target="_blank" rel="noopener">' + esc(x.l) + " ↗</a>";
    if (x.t === "campus") return '<a class="' + cls + '" href="/campus/" target="_blank" rel="noopener" data-ck-campus>' + esc(x.l) + " ↗</a>";
    if (x.t === "copiar") return '<button class="' + cls + '" type="button" data-copiar="' + esc(x.x) + '">' + esc(x.l) + "</button>";
    if (x.t === "mail") return '<a class="' + cls + '" href="mailto:' + SUPORTE + "?subject=" + encodeURIComponent(x.assunto || "") + '">' + esc(x.l) + "</a>";
    if (x.t === "convite") {
      var p = PLANOS.filter(function (y) { return y.id === x.p; })[0];
      return '<a class="' + cls + '" href="' + esc(p.convite) + '" target="_blank" rel="noopener" data-convite="' + p.id + '">Afiliar ao ' + esc(p.nome) + " ↗</a>";
    }
    return "";
  }

  function telaInicio(manterScroll) {
    var y = window.scrollY;
    var a = st.aff, ck = st.ck;
    var pr = progresso(a, ck);
    if (!st.abertas) st.abertas = new Set(pr.atual >= 0 ? [JORNADA[pr.atual].id] : []);
    var etapa = pr.atual >= 0 ? JORNADA[pr.atual] : null;
    var prox = etapa ? etapa.tarefas.filter(function (t) { return !tarefaFeita(t, a, ck); })[0] : null;
    var nome = esc(primeiroNome());
    var titulo = !etapa ? "Jornada completa, " + nome : pr.feitas === 0 ? "Boas-vindas à parceria, " + nome : "Seu próximo passo, " + nome;
    render(
      '<div class="page-head"><p class="eyebrow">Sua jornada de parceiro</p><h1>' + titulo + '<span class="dot">.</span></h1>' +
      "<p>São 8 etapas, do cadastro à rotina de vendas. Cada tarefa diz o que fazer, quanto tempo leva e quando está pronta. Marque ao terminar: o progresso fica salvo na sua conta.</p></div>" +
      (!a ? '<div class="jr-aviso">Você está vendo a jornada como administrador, sem conta de parceiro. O progresso fica salvo só neste navegador.</div>' : "") +
      topoJornada(pr, etapa, prox, a) +
      (paginaPronta() ? linhaLink() : "") +
      '<div class="jr-etapas">' + JORNADA.map(function (e, i) { return etapaHtml(e, i, a, ck, pr, prox); }).join("") + "</div>" +
      '<div class="jr-extra">' + cartaoComissao() + cartaoCampus() + "</div>"
    );
    ligarJornada();
    if (manterScroll) window.scrollTo(0, y);
  }

  function topoJornada(pr, etapa, prox, a) {
    var pct = pr.total ? Math.round(pr.feitas / pr.total * 100) : 0;
    var dots = JORNADA.map(function (e, i) {
      var ok = etapaFeita(e, a, st.ck);
      return '<button type="button" class="jr-dot' + (ok ? " ok" : "") + (i === pr.atual ? " atual" : "") + '" data-ir-et="' + e.id + '" title="Etapa ' + (i + 1) + ": " + esc(e.titulo) + '" aria-label="Etapa ' + (i + 1) + ": " + esc(e.titulo) + (ok ? " (concluída)" : "") + '">' + (ok ? ICO_CHECK : i + 1) + "</button>";
    }).join("");
    var lado;
    if (prox) {
      var acs = acoesDe(prox, a);
      var principal = acs.length ? acaoHtml(acs[0], true) : "";
      lado = '<div class="jr-next"><p class="eyebrow">Próxima tarefa</p><h3>' + esc(prox.titulo) + "</h3>" +
        '<p class="jr-next-meta">Etapa ' + (pr.atual + 1) + " · " + esc(etapa.titulo) + '<span class="tk-time">' + ICO_TEMPO + esc(prox.tempo) + "</span></p>" +
        '<p class="jr-next-desc">' + esc(prox.desc) + "</p>" +
        '<div class="jr-acts">' + principal + '<button class="btn small" type="button" data-ir-tk="' + prox.id + '">Ver como fazer</button></div></div>';
    } else {
      lado = '<div class="jr-next"><p class="eyebrow">Tudo pronto</p><h3>Você completou as 8 etapas.</h3>' +
        '<p class="jr-next-desc">Agora é rotina: vídeos todo dia, lives no mesmo horário e a revisão de sexta. Material novo aparece no Material de apoio.</p>' +
        '<div class="jr-acts">' + acaoHtml({ t: "mat", k: "rotina", l: "Ver a rotina da semana" }, true) + "</div></div>";
    }
    return '<div class="jr-top"><div class="jr-prog"><div class="jr-ring" style="--p:' + pct + '" role="img" aria-label="' + pct + '% da jornada concluída"><b>' + pct + "%</b></div>" +
      '<div class="jr-prog-txt"><p class="eyebrow">Seu progresso</p><h3>' + pr.feitas + " de " + pr.total + " tarefas</h3><p>" +
      (etapa ? "Você está na etapa " + (pr.atual + 1) + " de 8: " + esc(etapa.titulo) + "." : "As 8 etapas estão concluídas.") + "</p>" +
      '<div class="jr-dots">' + dots + "</div></div></div>" + lado + "</div>";
  }

  function linhaLink() {
    var link = linkPagina();
    return '<div class="panel jr-link"><p class="eyebrow">Seu endereço para divulgar</p><div class="copy-row"><span>' + esc(link) + '</span><a class="btn small" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir ↗</a><button class="btn small gold" type="button" data-copiar="' + esc(link) + '">Copiar</button></div></div>';
  }

  function etapaHtml(e, i, a, ck, pr, prox) {
    var feitas = e.tarefas.filter(function (t) { return tarefaFeita(t, a, ck); }).length;
    var tot = e.tarefas.length, ok = feitas === tot, atual = i === pr.atual;
    return '<details class="et' + (ok ? " ok" : "") + (atual ? " atual" : "") + '" id="et-' + e.id + '" data-et="' + e.id + '"' + (st.abertas.has(e.id) ? " open" : "") + ">" +
      '<summary><span class="et-num">' + (ok ? ICO_CHECK : String(i + 1).padStart(2, "0")) + "</span>" +
      '<span class="et-txt"><small>Etapa ' + (i + 1) + " · " + esc(e.tempo) + (atual ? ' <span class="badge-now">Você está aqui</span>' : "") + "</small>" +
      "<b>" + esc(e.titulo) + "</b><em>" + esc(e.sub) + "</em></span>" +
      '<span class="et-meta"><span class="et-count">' + feitas + " de " + tot + '</span><span class="et-bar"><i style="width:' + Math.round(feitas / tot * 100) + '%"></i></span></span>' +
      '<span class="et-chev" aria-hidden="true"></span></summary>' +
      '<div class="et-body">' + e.tarefas.map(function (t) { return tarefaHtml(t, a, ck, !!prox && prox.id === t.id); }).join("") +
      (ok ? '<p class="et-fim">' + ICO_CHECK + "Etapa concluída.</p>" : "") + "</div></details>";
  }

  function tarefaHtml(t, a, ck, agora) {
    var feito = tarefaFeita(t, a, ck), auto = tarefaAuto(t, a, ck);
    var travado = auto || (t.soAuto && !feito);
    var dica = auto ? "Concluída automaticamente" : t.soAuto ? t.autoTxt : feito ? "Desmarcar" : "Marcar como feita";
    var acs = acoesDe(t, a).map(function (x) { return acaoHtml(x, false); }).join("");
    return '<div class="tk' + (feito ? " ok" : "") + (agora ? " agora" : "") + '" id="tk-' + t.id + '">' +
      '<button class="tk-check" type="button" data-tk="' + t.id + '" aria-pressed="' + feito + '"' + (travado ? " disabled" : "") +
      ' title="' + esc(dica) + '" aria-label="' + esc((feito ? "Concluída: " : "Marcar como feita: ") + t.titulo) + '">' + ICO_CHECK + "</button>" +
      '<div class="tk-main"><div class="tk-head"><h4>' + esc(t.titulo) + '</h4><span class="tk-time">' + ICO_TEMPO + esc(t.tempo) + "</span>" +
      (agora ? '<span class="badge-now">Agora</span>' : "") + "</div>" +
      '<p class="tk-desc">' + esc(t.desc) + "</p>" + (t.extra ? t.extra(a) : "") +
      '<details class="tk-more"' + (feito ? "" : " open") + "><summary>Como fazer</summary>" +
      '<ol class="tk-steps">' + t.passos.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ol>" +
      '<p class="tk-ok"><b>Pronto quando:</b> ' + esc(t.pronto) + "</p>" +
      (t.autoTxt ? '<p class="tk-auto">' + esc(t.autoTxt) + "</p>" : "") + "</details>" +
      (acs ? '<div class="tk-acts">' + acs + "</div>" : "") + "</div></div>";
  }

  function cartaoComissao() {
    var linhas = PLANOS.map(function (p) {
      return "<tr><td><b>" + esc(p.nome) + "</b><small>" + esc(p.ganho) + "</small></td><td>" + brl(comissaoDe(p.preco, "pix")) + "</td><td>" + brl(comissaoDe(p.preco, "cartao")) + "</td></tr>";
    }).join("");
    return '<div class="panel com"><p class="eyebrow">Quanto você ganha</p><h3>50% de cada venda, depois da taxa da Cakto</h3>' +
      '<table class="com-tab"><thead><tr><th>Plano</th><th>Pix</th><th>Cartão</th></tr></thead><tbody>' + linhas + "</tbody></table>" +
      '<div class="calc"><p class="calc-t">Simule um mês</p><div class="calc-row">' +
      '<label class="calc-f">Vendas do Mensal<input id="cM" type="number" inputmode="numeric" min="0" max="999" value="' + st.calc.m + '"></label>' +
      '<label class="calc-f">Vendas do Vitalício<input id="cV" type="number" inputmode="numeric" min="0" max="999" value="' + st.calc.v + '"></label>' +
      '<div class="seg" role="group" aria-label="Forma de pagamento">' + ["pix", "cartao"].map(function (f) {
        return '<button type="button" data-forma="' + f + '" aria-pressed="' + (st.calc.forma === f) + '">' + TAXAS[f].nome + "</button>";
      }).join("") + "</div></div>" +
      '<p class="calc-res">Comissão das vendas do mês: <b id="cRes"></b></p><p class="calc-obs" id="cObs"></p></div>' +
      '<p class="hint">Taxas da Cakto em setembro de 2026: Pix, R$\u00a02,49 por venda; cartão, 4,99% + R$\u00a02,49. Os valores são aproximados: o valor exato de cada venda aparece no seu painel da Cakto. Reembolso e chargeback cancelam a comissão. A simulação é só para você entender a conta: não é promessa de ganho e não pode ser usada na divulgação.</p></div>';
  }
  function ligarCalc() {
    var m = $("cM"), v = $("cV");
    if (!m) return;
    var atualiza = function () {
      st.calc.m = Math.max(0, Math.min(999, parseInt(m.value, 10) || 0));
      st.calc.v = Math.max(0, Math.min(999, parseInt(v.value, 10) || 0));
      var mensal = st.calc.m * comissaoDe(PLANOS[0].preco, st.calc.forma);
      $("cRes").textContent = brl(mensal + st.calc.v * comissaoDe(PLANOS[1].preco, st.calc.forma));
      $("cObs").textContent = !st.calc.m ? "" : st.calc.m === 1
        ? "Se esse aluno do Mensal continuar assinando, cada mês seguinte rende de novo " + brl(mensal) + "."
        : "Se esses " + st.calc.m + " alunos do Mensal continuarem assinando, cada mês seguinte rende de novo " + brl(mensal) + ".";
    };
    m.addEventListener("input", atualiza);
    v.addEventListener("input", atualiza);
    document.querySelectorAll("#conteudo [data-forma]").forEach(function (b) {
      b.addEventListener("click", function () {
        st.calc.forma = b.getAttribute("data-forma");
        document.querySelectorAll("#conteudo [data-forma]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        atualiza();
      });
    });
    atualiza();
  }
  function cartaoCampus() {
    return '<div class="panel"><p class="eyebrow">Para suas lives</p><h3>Campus em demonstração</h3>' +
      '<p class="hint" style="font-size:14px;margin:6px 0 14px">Entre no campus com esta mesma conta para mostrar a plataforma: você vê os 13 módulos e o Plano 30 dias, e a aula 1 fica liberada para apresentar.</p>' +
      '<div class="tk-acts">' + acaoHtml({ t: "campus", l: "Abrir o campus" }, false) + acaoHtml({ t: "mat", k: "tour", l: "Como mostrar na live" }, false) + "</div></div>";
  }

  function ligarJornada() {
    var raiz = $("conteudo");
    raiz.querySelectorAll("[data-tk]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.getAttribute("data-tk"), antes = etapasFeitas();
        setCk(id, !st.ck[id]);
        depoisDeMudar(antes);
      });
    });
    raiz.querySelectorAll("details[data-et]").forEach(function (d) {
      d.addEventListener("toggle", function () { var id = d.getAttribute("data-et"); if (d.open) st.abertas.add(id); else st.abertas.delete(id); });
    });
    raiz.querySelectorAll("[data-ler]").forEach(function (b) { b.addEventListener("click", function () { lerMaterial(b.getAttribute("data-ler")); }); });
    raiz.querySelectorAll("[data-convite]").forEach(function (x) {
      x.addEventListener("click", function () {
        var antes = etapasFeitas();
        if (setCk("conv_" + x.getAttribute("data-convite"), true)) setTimeout(function () { depoisDeMudar(antes); }, 400);
      });
    });
    raiz.querySelectorAll("[data-ck-campus]").forEach(function (x) { x.addEventListener("click", function () { setCk("campus", true); }); });
    raiz.querySelectorAll("[data-ir-tk]").forEach(function (b) { b.addEventListener("click", function () { irTarefa(b.getAttribute("data-ir-tk")); }); });
    raiz.querySelectorAll("[data-ir-et]").forEach(function (b) { b.addEventListener("click", function () { irEtapa(b.getAttribute("data-ir-et")); }); });
    ligarCopiar();
    ligarCalc();
  }

  // Depois de marcar algo: se uma etapa acabou de ser concluída, fecha ela e abre a próxima.
  function depoisDeMudar(antes) {
    var agora = etapasFeitas(), nova = -1;
    agora.forEach(function (f, i) { if (f && !antes[i]) nova = i; });
    var prox = agora.indexOf(false);
    if (nova >= 0) {
      st.abertas.delete(JORNADA[nova].id);
      if (prox >= 0) st.abertas.add(JORNADA[prox].id);
      toast(prox >= 0 ? "Etapa " + (nova + 1) + " concluída! Agora: " + JORNADA[prox].titulo + "." : "Jornada completa! Agora é rotina.");
    }
    if (vistaAtual() !== "inicio") return;
    telaInicio(true);
    if (nova >= 0 && prox >= 0) irEtapa(JORNADA[prox].id);
  }
  function irEtapa(id) {
    var el = $("et-" + id);
    if (!el) return;
    st.abertas.add(id);
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function irTarefa(id) {
    var e = JORNADA.filter(function (x) { return x.tarefas.some(function (t) { return t.id === id; }); })[0];
    if (!e) return;
    var et = $("et-" + e.id), tk = $("tk-" + id);
    if (!et || !tk) return;
    st.abertas.add(e.id);
    et.open = true;
    var mais = tk.querySelector(".tk-more");
    if (mais) mais.open = true;
    tk.scrollIntoView({ behavior: "smooth", block: "center" });
    tk.classList.remove("flash"); void tk.offsetWidth; tk.classList.add("flash");
  }

  // ---------- Minha página de vendas ----------
  function telaPagina() {
    if (!st.aff) {
      render('<div class="page-head"><p class="eyebrow">Prévia de administrador</p><h1>Sua página de vendas<span class="dot">.</span></h1>' +
        "<p>Cada parceiro configura aqui o apelido e os links de afiliado da Cakto. Esta conta é de administrador e não tem página própria.</p></div>" +
        '<div class="panel"><p class="hint" style="font-size:14px;margin:0">Para testar o fluxo do parceiro, ative a parceria com outra conta pelo botão <b>Quero ser parceiro</b>, na tela de entrada.</p></div>');
      return;
    }
    var a = st.aff;
    var link = linkPagina();
    render(
      '<div class="page-head"><p class="eyebrow">Pronta para divulgar</p><h1>Sua página de vendas<span class="dot">.</span></h1>' +
      "<p>É a página oficial da LowLab com os botões de compra apontando para os seus links de afiliado. Plano sem link salvo não aparece na sua página.</p></div>" +
      '<div class="panel"><p class="eyebrow">Antes de colar os links</p><h3>Afilie-se aos dois planos na Cakto</h3>' +
      '<ol class="guia"><li>Clique nos botões abaixo e peça a afiliação. Se ainda não tiver conta na Cakto, ela pede para você criar. A aprovação é automática.<span class="guia-acts">' + botoesConvite(paginaPronta() ? "" : " gold") + "</span></li>" +
      "<li>Na Cakto, abra <b>Produtos › Minhas Afiliações</b> e, no produto, clique em <b>Ver Links</b>. O Mensal se chama <b>LowLab Campus</b> e o Vitalício, <b>LowLab Vitalício</b>.</li>" +
      "<li>Copie o link completo de cada plano e cole no campo certo aqui embaixo, junto com seu apelido.</li></ol>" +
      '<p class="hint" style="font-size:14px;margin:0">Dúvida? O passo a passo completo está no <a href="#material">Material de apoio</a>, em Afiliação na Cakto e sua página.</p></div>' +
      (link ? '<div class="panel"><p class="eyebrow">Seu endereço para divulgar</p><div class="copy-row"><span>' + esc(link) + '</span><a class="btn small" href="' + esc(link) + '" target="_blank" rel="noopener">Abrir ↗</a><button class="btn small gold" type="button" data-copiar="' + esc(link) + '">Copiar</button></div></div>' : "") +
      '<form class="panel" id="fPagina" novalidate><div class="grid2"><div><label for="pNome">Seu nome na página</label><input id="pNome" type="text" maxlength="60" value="' + esc(a.display_name || (st.profile && st.profile.full_name) || "") + '" placeholder="Ex.: Ana Souza"><p class="hint">Aparece discretamente na página como quem indicou.</p></div>' +
      '<div><label for="pSlug">Apelido do endereço</label><input id="pSlug" type="text" maxlength="30" value="' + esc(a.slug || "") + '" placeholder="ex.: ana-souza"><p class="hint">' + esc(SITE) + '/p/<b id="slugPrev">' + esc(a.slug || "seu-apelido") + "</b> · letras minúsculas, números e hífen</p></div></div>" +
      '<p class="eyebrow" style="margin-top:22px">Seus links de afiliado da Cakto</p><p class="hint" style="font-size:14px">Na Cakto: Produtos › Minhas Afiliações › produto › Ver Links. Copie o link completo, que começa com https://pay.cakto.com.br/.</p>' +
      PLANOS.map(function (p) {
        return '<label for="pl_' + p.id + '">' + esc(p.nome) + " · " + brl(p.preco) + p.periodo + ' <span class="lbl-sub">na Cakto: ' + esc(p.cakto) + "</span></label>" +
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
    var r = await sb.from("affiliates").update(dados).eq("user_id", st.user.id).select(COLS_AFF).maybeSingle();
    b.disabled = false; b.textContent = "Salvar minha página";
    if (r.error || !r.data) { msg(out, traduz(r.error || "erro"), "err"); return; }
    st.aff = Object.assign({}, st.aff, r.data);
    toast("Página salva!");
    telaPagina();
    var ambos = !!(st.aff.link_campus && st.aff.link_circulo);
    msg($("mPagina"), ambos ? "Tudo certo: sua página está no ar. Próximo passo em Meu espaço: teste a página como um cliente."
      : paginaPronta() ? "Salvo. Sua página está no ar com um plano; cole o link do outro plano para ele aparecer também."
      : "Salvo. Cole pelo menos um link para sua página aparecer.", "ok");
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
      "<p>" + (ativas.length ? feitas + " de " + ativas.length + " aulas concluídas. Vá no seu ritmo." : "Nenhuma aula publicada ainda. Os parceiros só veem esta página quando houver aula publicada.") + "</p></div>" +
      (mods.length > 1 ? '<div class="chips"><button class="chip' + (st.filtro === "todos" ? " active" : "") + '" data-filtro="todos">Todos os módulos</button>' +
        mods.map(function (m) { return '<button class="chip' + (st.filtro === m ? " active" : "") + '" data-filtro="' + esc(m) + '">' + esc(m) + "</button>"; }).join("") + "</div>" : "") +
      (lista.length ? '<div class="lessons">' + lista.map(function (l) {
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
    { id: "comece", titulo: "Comece aqui", desc: "Como a parceria funciona, a afiliação na Cakto, as regras e a rotina da semana." },
    { id: "entenda", titulo: "Entenda o que você vende", desc: "O pitch, o tour pela plataforma, o case do Bruno e as respostas às objeções." },
    { id: "conteudo", titulo: "Crie conteúdo", desc: "Perfil, bio, os 7 primeiros dias, ganchos, mensagens prontas e cortes." },
    { id: "live", titulo: "Venda ao vivo", desc: "Checklist, roteiro de 60 minutos, respostas para o chat e o que nunca dizer." },
    { id: "videos", titulo: "Vídeos para cortes", desc: "Copie o link do vídeo e cole no Opus Clip para gerar seus cortes. Nos cortes, dê o crédito a quem aparece no vídeo." },
    { id: "outros", titulo: "Mais materiais", desc: "" }
  ];
  var ICONE = {
    text: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg>',
    link: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
    video: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/></svg>',
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
  function lidoMat(m) { return !!(m.key && st.ck["m_" + m.key]); }
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
    if (secaoDe(m) === "videos" && m.kind === "link" && m.url) {
      return '<div class="mat-row mat-video"><span class="mat-ico">' + ICONE.video + "</span>" + txt +
        '<span class="mat-acts"><button class="btn small gold" type="button" data-copiar="' + esc(m.url) + '">Copiar link</button><a class="btn small" href="' + esc(m.url) + '" target="_blank" rel="noopener">Assistir ↗</a></span></div>';
    }
    if (m.kind !== "text" && m.url) {
      return '<a class="mat-row link" href="' + esc(m.url) + '" target="_blank" rel="noopener"' + (m.key === "convite_mensal" ? ' data-convite="campus"' : m.key === "convite_vitalicio" ? ' data-convite="circulo"' : "") + '><span class="mat-ico">' + (ICONE[m.kind] || ICONE.link) + "</span>" + txt +
        '<span class="mat-go">' + (m.kind === "file" ? "Baixar" : "Abrir") + " ↗</span></a>";
    }
    var lido = lidoMat(m);
    return '<button class="mat-row' + (lido ? " lido" : "") + '" type="button" data-ler="' + esc(m.id) + '"><span class="mat-ico">' + (lido ? ICO_CHECK : ICONE.text) + "</span>" + txt +
      '<span class="mat-go"><em>' + minutos(m.body) + " min</em>" + (lido ? '<span class="mat-lido">Lido</span>' : "Ler →") + "</span></button>";
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
    var antes = etapasFeitas();
    if (m.key && setCk("m_" + m.key, true)) { st.sujo = true; st.antesModal = antes; }
  }
  function telaMaterial(manterScroll) {
    var y = window.scrollY;
    var ativos = st.materials.filter(function (x) { return x.active; });
    var regras = matKey("regras") || ativos.filter(function (m) { return m.kind === "text" && /^regras/i.test(m.title); })[0];
    var usadas = SECOES.filter(function (s) { return s.id === "videos" || ativos.some(function (m) { return secaoDe(m) === s.id; }); });
    var guiaOpus = matKey("opus") || ativos.filter(function (m) { return m.kind === "text" && /opus clip/i.test(m.title); })[0];
    var comKey = ativos.filter(function (m) { return m.key && m.kind === "text"; });
    var lidos = comKey.filter(lidoMat).length;
    render(
      '<div class="page-head"><p class="eyebrow">Para colocar em prática</p><h1>Material de apoio<span class="dot">.</span></h1><p>Tudo o que você precisa para divulgar a LowLab, na ordem em que vai usar.' +
      (comKey.length ? " Você já leu " + lidos + " de " + comKey.length + " textos." : "") + "</p></div>" +
      '<div class="mat-rules"><p><b>Antes de postar:</b> pode mostrar a plataforma, contar a sua experiência e usar os textos daqui. Não pode prometer ganho ou resultado, mostrar print de venda que não é seu ou que foi alterado, usar o nome LowLab em perfil, página ou domínio próprio, nem fazer spam. Quem descumpre recebe uma advertência; na segunda vez, sai do programa.</p>' +
      (regras ? '<button class="btn small gold" type="button" data-ler="' + esc(regras.id) + '">Ler as regras</button>' : "") + "</div>" +
      (usadas.length > 1 ? '<div class="mat-nav">' + usadas.map(function (s, i) { return '<button class="chip" type="button" data-ir="' + s.id + '">' + (i + 1) + ". " + esc(s.titulo) + "</button>"; }).join("") + "</div>" : "") +
      (usadas.length ? usadas.map(function (s, i) {
        var itens = ativos.filter(function (m) { return secaoDe(m) === s.id; });
        var vazio = s.id === "videos" && !itens.length;
        return '<section class="mat-sec" id="sec-' + s.id + '"><div class="mat-sec-head"><span class="mat-sec-num">' + (i + 1) + "</span><div><h2>" + esc(s.titulo) + "</h2>" + (s.desc ? "<p>" + esc(s.desc) + "</p>" : "") + "</div></div>" +
          (vazio ? '<div class="mat-vazio"><p><b>Em breve:</b> o vídeo do Bruno contando a história dele. Quando chegar, é só copiar o link aqui e colar no Opus Clip.</p>' +
            (guiaOpus ? '<button class="btn small" type="button" data-ler="' + esc(guiaOpus.id) + '">Como fazer cortes com o Opus Clip</button>' : "") + "</div>"
          : '<div class="mat-list">' + itens.map(linhaMaterial).join("") + "</div>" +
            (s.id === "videos" && guiaOpus ? '<p class="mat-dica">Primeira vez no Opus Clip? <button class="link" type="button" data-ler="' + esc(guiaOpus.id) + '">Veja o passo a passo</button>.</p>' : "")) +
          "</section>";
      }).join("") : '<div class="empty">O material de apoio está sendo preparado.</div>')
    );
    document.querySelectorAll("#conteudo [data-ler]").forEach(function (b) { b.addEventListener("click", function () { lerMaterial(b.getAttribute("data-ler")); }); });
    ligarCopiar();
    ligarConvites();
    document.querySelectorAll("#conteudo [data-ir]").forEach(function (b) {
      b.addEventListener("click", function () { var el = $("sec-" + b.getAttribute("data-ir")); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); });
    });
    if (manterScroll) window.scrollTo(0, y);
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
    if (!ehAdmin()) { location.hash = "inicio"; return; }
    render('<div class="page-head"><p class="eyebrow">Só para você</p><h1>Administração<span class="dot">.</span></h1><p>Afiliados, aulas e material da Área de Parceiros.</p></div>' +
      '<div class="chips">' + [["afiliados", "Afiliados"], ["aulas", "Aulas"], ["material", "Material"]].map(function (t) {
        return '<button class="chip' + (adminAba === t[0] ? " active" : "") + '" data-aba="' + t[0] + '">' + t[1] + "</button>";
      }).join("") + '</div><div id="adminCorpo"><div class="loader" style="margin:30px auto"></div></div>');
    document.querySelectorAll("[data-aba]").forEach(function (b) { b.addEventListener("click", function () { adminAba = b.getAttribute("data-aba"); telaAdmin(); }); });
    if (adminAba === "afiliados") await adminAfiliados();
    else if (adminAba === "aulas") adminAulas();
    else adminMaterial();
  }

  function jornadaCelula(x) {
    var ck = x.checklist && typeof x.checklist === "object" ? x.checklist : {};
    var pr = progresso(x, ck), pct = Math.round(pr.feitas / pr.total * 100);
    return '<div class="mini"><span>' + pr.feitas + "/" + pr.total + '</span><span class="mini-bar"><i style="width:' + pct + '%"></i></span></div>' +
      "<small>" + (pr.atual >= 0 ? "Etapa " + (pr.atual + 1) + " · " + esc(JORNADA[pr.atual].titulo) : "Jornada completa") + "</small>";
  }
  async function adminAfiliados() {
    var a = await sb.from("affiliates").select(COLS_AFF + ",checklist").order("created_at", { ascending: false });
    if (a.error) a = await sb.from("affiliates").select(COLS_AFF).order("created_at", { ascending: false });
    var ids = (a.data || []).map(function (x) { return x.user_id; });
    var p = ids.length ? await sb.from("profiles").select("id,email,full_name").in("id", ids) : { data: [] };
    var porId = {}; (p.data || []).forEach(function (x) { porId[x.id] = x; });
    var linhas = (a.data || []).map(function (x) {
      var pr = porId[x.user_id] || {};
      return "<tr><td><b>" + esc(pr.full_name || x.display_name || "—") + "</b><br><small>" + esc(pr.email || "") + "</small></td>" +
        "<td>" + jornadaCelula(x) + "</td>" +
        "<td>" + (x.slug ? '<a href="/p/' + esc(x.slug) + '" target="_blank" rel="noopener">/p/' + esc(x.slug) + "</a>" : "<small>sem página</small>") + "</td>" +
        "<td>" + (x.link_campus ? '<span class="badge ok">Mensal</span> ' : "") + (x.link_circulo ? '<span class="badge ok">Vitalício</span>' : "") + (!x.link_campus && !x.link_circulo ? "<small>nenhum</small>" : "") + "</td>" +
        "<td><small>" + new Date(x.created_at).toLocaleDateString("pt-BR") + "</small></td>" +
        '<td><span class="badge ' + (x.status === "active" ? "ok" : "err") + '">' + (x.status === "active" ? "Ativo" : "Bloqueado") + "</span></td>" +
        '<td><button class="btn small ' + (x.status === "active" ? "danger" : "") + '" data-status="' + esc(x.user_id) + '" data-novo="' + (x.status === "active" ? "blocked" : "active") + '">' + (x.status === "active" ? "Bloquear" : "Reativar") + "</button></td></tr>";
    }).join("");
    var qtd = (a.data || []).length;
    $("adminCorpo").innerHTML = '<div class="panel"><p class="eyebrow">' + qtd + (qtd === 1 ? " afiliado" : " afiliados") + "</p>" +
      (linhas ? '<div class="table-wrap"><table><thead><tr><th>Afiliado</th><th>Jornada</th><th>Página</th><th>Links</th><th>Desde</th><th>Status</th><th></th></tr></thead><tbody>' + linhas + "</tbody></table></div>" : '<div class="empty">Nenhum afiliado ainda.</div>') + "</div>";
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
      return "<tr><td><small>" + m.position + " · " + esc(sec ? sec.titulo : "") + " · " + esc(tipos[m.kind] || m.kind) + (m.key ? " · usado na jornada" : "") + "</small><br><b>" + esc(m.title) + "</b></td>" +
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
      (e.key ? '<p class="hint" style="font-size:14px">Este material aparece nas tarefas da Jornada do parceiro. Se ocultar ou excluir, o atalho some da tarefa.</p>' : "") +
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

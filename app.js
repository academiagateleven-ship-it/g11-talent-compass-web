"use strict";
const byId = (id) => document.getElementById(id);
const roles = { colaborador: "Colaborador", supervisor: "Supervisão", manager: "Manager", admin: "Admin" };
const identitySuffix = "@access.talent-compass.invalid";
const db = window.supabase?.createClient("https://nvlnulndlnxctcshyrnp.supabase.co", "sb_publishable_7rR80gMcy9at06Jx1gcIzA_XTks6H7S", { auth: { persistSession: false, detectSessionInUrl: false } });
const setupParameter = new URLSearchParams(window.location.hash.slice(1)).get("ativar");
let setupToken = /^[0-9a-f]{64}$/.test(setupParameter ?? "") ? setupParameter : null;
if (setupToken) window.history.replaceState(null, "", window.location.pathname + window.location.search);

let reports = [];
let activeUser = null;

function status(message = "") {
  byId("status").textContent = message;
  byId("status").hidden = !message;
}

function clearDashboard() {
  reports = [];
  activeUser = null;
  for (const id of ["metrics", "priorities", "accounts", "scope", "scope-list", "pulse-charts", "general-charts", "analysis-content", "insights"]) byId(id).replaceChildren();
  byId("permission-form").reset();
  byId("target").readOnly = false;
  byId("report-note").textContent = "";
  byId("dashboard").hidden = true;
  byId("logout").hidden = true;
  byId("auth").hidden = false;
}

async function loadDashboard() {
  const { data: { user }, error: userError } = await db.auth.getUser();
  if (userError || !user) return;
  const code = user.email?.endsWith(identitySuffix) ? user.email.slice(0, -identitySuffix.length) : "";
  const { data: profile, error } = await db.from("compass_tiers").select("role,active").eq("code", code).maybeSingle();
  if (error || !profile?.active) {
    await db.auth.signOut();
    clearDashboard();
    status("Esta conta ainda precisa de autorização do administrador do Talent Compass.");
    return;
  }
  const { data, error: reportError } = await db.from("compass_reports").select("scope,snapshot").order("scope");
  if (reportError) {
    await db.auth.signOut();
    clearDashboard();
    status("Não foi possível carregar o relatório. Tenta novamente.");
    return;
  }
  reports = data;
  activeUser = profile;
  const locations = reports.filter(row => row.scope !== "executivo");
  byId("scope").replaceChildren(...locations.map(row => new Option(row.scope, row.scope)));
  byId("nav-locations").hidden = !locations.length;
  byId("nav-admin").hidden = profile.role !== "admin";
  byId("role").textContent = roles[profile.role];
  byId("auth").hidden = true;
  byId("dashboard").hidden = false;
  byId("logout").hidden = false;
  status();
  openSection("exec");
}

function node(tag, value, className) {
  const element = document.createElement(tag);
  if (value != null) element.textContent = value;
  if (className) element.className = className;
  return element;
}

function renderReport(scope) {
  const snapshot = reports.find(row => row.scope === scope)?.snapshot;
  byId("report-title").textContent = scope === "executivo" ? "Visão executiva" : scope;
  byId("metrics").replaceChildren();
  byId("priorities").replaceChildren();
  byId("priority-panel").hidden = !snapshot?.prioridades?.length;
  const insights = snapshot?.analises?.insights ?? [];
  byId("insights").replaceChildren(...insights.map(text => node("li", text)));
  byId("insight-panel").hidden = !insights.length;
  byId("report-note").textContent = snapshot?.notas || "";
  byId("cutoff").textContent = snapshot ? "Dados de " + new Intl.DateTimeFormat("pt-PT", { dateStyle: "long", timeZone: "UTC" }).format(new Date(snapshot.data)) : "Sem dados disponíveis.";
  const charts = scope === "executivo" ? snapshot?.charts ?? [] : [];
  byId("executive-charts").hidden = !charts.length;
  byId("pulse-charts").replaceChildren(...charts.slice(0, 2).map(renderChart));
  byId("general-charts").replaceChildren(...charts.slice(2).map(renderChart));
  if (!snapshot) return;
  for (const survey of snapshot.inqueritos) {
    const item = node("article", null, "panel metric");
    const rate = survey.universo ? new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 1 }).format(survey.respondidas / survey.universo) : "—";
    item.append(node("h2", survey.nome), node("strong", rate), node("p", survey.universo ? survey.respondidas + " / " + survey.universo + " elegíveis" : "Amostra insuficiente"));
    byId("metrics").append(item);
  }
  renderBars(snapshot.prioridades ?? [], byId("priorities"));
}

function renderChart(chart) {
  const card = node("article", null, "panel report-chart");
  card.append(node("h3", chart.title));
  if (chart.note) card.append(node("p", chart.note, "sub"));
  const chartRows = node("div");
  renderBars(chart.rows, chartRows);
  card.append(chartRows);
  return card;
}

function renderBars(items, container) {
  const max = Math.max(1, ...items.map(([, count]) => count));
  for (const [label, count] of items) {
    const row = node("div", null, "priority-row");
    const bar = node("progress");
    bar.max = max;
    bar.value = count;
    bar.setAttribute("aria-label", label);
    row.append(node("span", label), bar, node("strong", count));
    container.append(row);
  }
}

const analysisTitles = {
  participation: "Participação", people: "People Pulse", ai: "AI Pulse",
  survey1: "Inquérito 1 · Necessidades de Formação",
  survey2: "Inquérito 2 · Liderança",
  survey3: "Inquérito 3 · Percurso e Desenvolvimento",
  comparison: "Convergências & Gaps",
  action: "From Listening to Action", method: "Metodologia",
};

function openSection(section) {
  if (section === "admin" && activeUser?.role !== "admin") return;
  const analysis = Object.hasOwn(analysisTitles, section);
  for (const button of byId("dashboard").querySelectorAll(".nav button")) {
    if (button.id === "nav-" + section) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  byId("report").hidden = section === "admin" || analysis;
  byId("analysis").hidden = !analysis;
  byId("admin").hidden = section !== "admin";
  byId("scope-label").hidden = section !== "locations";
  if (section === "admin") return loadPermissions();
  if (analysis) return renderAnalysis(section);
  renderReport(section === "exec" ? "executivo" : byId("scope").value);
}

function tableCard(title, columns, rows, note) {
  const card = node("article", null, "panel analysis-card");
  const label = node("h2", title);
  label.tabIndex = -1;
  card.append(label);
  if (note) card.append(node("p", note, "sub"));
  const frame = node("div", null, "table-scroll");
  const table = node("table");
  table.setAttribute("aria-label", title);
  const headers = table.createTHead().insertRow();
  for (const column of columns) {
    const cell = node("th", column);
    cell.scope = "col";
    headers.append(cell);
  }
  const body = table.createTBody();
  for (const [first, ...rest] of rows) {
    const row = body.insertRow();
    const heading = node("th", first);
    heading.scope = "row";
    row.append(heading);
    for (const value of rest) row.append(node("td", value));
  }
  frame.append(table);
  card.append(frame);
  return card;
}

function chartGrid(charts) {
  const grid = node("div", null, "chart-grid");
  grid.append(...charts.map(renderChart));
  return grid;
}

const percent = new Intl.NumberFormat("pt-PT", { style: "percent", maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 2 });

function participationCards(snapshot, participation) {
  const surveyNames = snapshot.inqueritos.map((survey, index) => "Inquérito " + (index + 1));
  const cards = [tableCard("Universo e participação", ["Inquérito", "Respostas elegíveis", "Universo", "Em falta", "Taxa"],
    snapshot.inqueritos.map(({ nome, respondidas, universo }) =>
      [nome, respondidas, universo, universo - respondidas, percent.format(respondidas / universo)]))];
  const panel = node("article", null, "panel analysis-card");
  const label = node("label", "Agrupar por ");
  const filter = node("select");
  filter.append(new Option("Área de atividade", "segments"), new Option("Regime de trabalho", "regimes"));
  label.append(filter);
  const details = node("div");
  function draw() {
    const rows = participation[filter.value].map(({ label, surveys }) => [label, ...surveys.map(
      amount => amount ? amount[0] + " / " + amount[1] + " (" + percent.format(amount[0] / amount[1]) + ")" : "—"
    )]);
    details.replaceChildren(tableCard("Participação por grupo", ["Grupo", ...surveyNames], rows,
      "Respostas elegíveis / universo. O traço indica que o desdobramento foi suprimido para proteger grupos pequenos."));
  }
  filter.addEventListener("change", draw);
  draw();
  panel.append(label, details);
  cards.push(panel);
  return cards;
}

const actionSteps = [
  ["Ouvir", "Recolher os contributos dos colaboradores, da liderança e do inquérito sobre percurso."],
  ["Analisar", "Cruzar participação, prioridades, diferenças e competências emergentes."],
  ["Priorizar", "Distinguir necessidades estruturais, emergentes e específicas."],
  ["Desenhar", "Definir a estrutura do plano bienal, os formatos e as experiências de aprendizagem."],
  ["Ativar e evoluir", "Implementar, medir resultados e ajustar o plano ao longo do ciclo."],
];
const methods = [
  ["Data de referência", "19 de novembro de 2026. Os dados são intercalares."],
  ["Deduplicação", "Considerou-se a resposta mais recente por identificador. Os relatórios apresentam apenas resultados agregados."],
  ["Universo operacional", "O denominador corresponde aos elegíveis em cada inquérito. No Inquérito 3, o universo abrange a sede, os efetivos e funções ou missões de responsabilidade."],
  ["Regimes e atividade", "A Participação permite consultar desdobramentos disponíveis por FT/PT e Equipas Comerciais/Backoffice."],
  ["Localizações", "A leitura operacional por loja ou unidade é disponibilizada segundo as permissões do perfil."],
  ["Proteção de grupos pequenos", "Algumas categorias foram agrupadas. Os desdobramentos com volumes reduzidos foram suprimidos."],
  ["Finalidade", "Apoiar a proposta do Plano Bienal de Formação Contínua Gateleven 2027 – abril de 2029."],
];

function textCards(entries) {
  const grid = node("div", null, "chart-grid");
  for (const [heading, copy] of entries) {
    const card = node("article", null, "panel report-chart");
    card.append(node("h3", heading), node("p", copy));
    grid.append(card);
  }
  return grid;
}

function renderAnalysis(section) {
  const snapshot = reports.find(row => row.scope === "executivo")?.snapshot;
  const detail = snapshot?.analises;
  const content = byId("analysis-content");
  const summary = byId("analysis-note");
  const title = byId("analysis-title");
  title.textContent = analysisTitles[section];
  content.replaceChildren();
  summary.textContent = "";
  if (section === "action") {
    summary.textContent = "Da escuta ao Plano Bienal de Formação Contínua Gateleven 2027 – abril de 2029.";
    const flow = node("ol", null, "action-flow");
    for (const [label, description] of actionSteps) {
      const step = node("li", null, "panel");
      step.append(node("h2", label), node("p", description));
      flow.append(step);
    }
    content.append(flow, textCards([
      ["O que o dashboard entrega", "Visibilidade da participação, indicadores, comparação entre perspetivas e prioridades emergentes."],
      ["O que o relatório final entregará", "Conclusões consolidadas, fundamentação, prioridades do plano, recomendações e compromissos de desenvolvimento."],
    ]));
  } else if (section === "method") {
    summary.textContent = "Critérios de leitura dos resultados do Talent Compass.";
    content.append(textCards(methods));
    if (detail) content.append(tableCard("Reconciliação dos inquéritos",
      ["Inquérito", "Respostas brutas", "Identificadores distintos", "Dentro do universo operacional"],
      snapshot.inqueritos.map(({ nome, respondidas }, i) => [nome, detail.rawCounts[i], detail.surveys[i].n, respondidas]),
      "Os totais dos três inquéritos não representam pessoas distintas entre questionários."));
  } else if (!detail) {
    summary.textContent = "Os dados desta secção estão temporariamente indisponíveis.";
  } else if (section === "participation") {
    summary.textContent = "Acompanhamento da participação no universo elegível de cada inquérito.";
    content.append(...participationCards(snapshot, detail.participation));
  } else if (section === "people") {
    summary.textContent = "Perfil das " + detail.people.n + " respostas distintas ao Inquérito 1. A amostra respondente é a base de leitura.";
    content.append(chartGrid(detail.people.charts));
  } else if (section === "ai") {
    summary.textContent = "Inquérito 1 · " + detail.ai.n + " respostas.";
    content.append(chartGrid(snapshot.charts.slice(0, 2)), textCards([
      ["IA como necessidade atual", detail.ai.need + " menções"],
      ["IA como competência futura", detail.ai.future + " menções"],
    ]));
  } else if (section === "comparison") {
    summary.textContent = "Prioridades ponderadas dos colaboradores e da liderança, normalizadas de 0 a 100 em cada grupo.";
    content.append(tableCard("Colaboradores e liderança", ["Prioridade", "Colaboradores", "Liderança", "Diferença", "Leitura"],
      detail.comparisons.map(row => [row.cat, row.collab, row.lead, row.gap, row.type]),
      "A diferença corresponde à distância entre os dois índices. Zero indica que o tema não integrou as prioridades apresentadas para esse grupo."),
      chartGrid([{ title: "Cinco prioridades emergentes", note: "Índice composto", rows: detail.emerging }]));
  } else {
    const survey = detail.surveys[Number(section.slice(-1)) - 1];
    summary.textContent = survey.n + " respostas distintas. A base analítica pode diferir do universo elegível da Participação.";
    if (survey.metric) content.append(textCards([[survey.metric[0], decimal.format(survey.metric[1]) + " / 5"]]));
    content.append(chartGrid(survey.charts));
  }
}

function updateScopeFields() {
  byId("scope-field").hidden = byId("target-role").value === "colaborador";
}

function editPermission(profile) {
  byId("target").value = profile.code;
  byId("target").readOnly = true;
  updatePasswordField(true);
  byId("target-role").value = profile.role;
  byId("target-active").checked = profile.active;
  for (const checkbox of byId("scope-list").querySelectorAll("input")) checkbox.checked = profile.scopes.includes(checkbox.value);
  updateScopeFields();
  byId("target-role").focus();
}

async function loadPermissions() {
  const scopeFields = byId("scope-list");
  if (!scopeFields.children.length) for (const { scope } of reports.filter(row => row.scope !== "executivo")) {
    const label = node("label", null, "check");
    const checkbox = node("input");
    checkbox.type = "checkbox";
    checkbox.value = scope;
    label.append(checkbox, node("span", scope));
    scopeFields.append(label);
  }
  const { data, error } = await db.from("compass_tiers").select("code,role,scopes,active").order("code");
  if (error) return status("Não foi possível carregar as permissões.");
  byId("accounts").replaceChildren();
  for (const profile of data) {
    const row = node("div", null, "account-row");
    const identity = node("div", "Código " + profile.code);
    identity.append(node("small", roles[profile.role] + " · " + (profile.active ? "Ativo" : "Suspenso")));
    row.append(identity);
    if (profile.role !== "admin") {
      const edit = node("button", "Editar", "quiet");
      edit.type = "button";
      edit.addEventListener("click", () => editPermission(profile));
      row.append(edit);
    }
    byId("accounts").append(row);
  }
}

function updatePasswordField(editing) {
  byId("target-reset").hidden = !editing;
  byId("target-secret").required = !editing;
  byId("target-secret").value = "";
  byId("target-secret-caption").textContent = editing ? "Nova palavra-passe (opcional)" : "Palavra-passe inicial";
}

function validPassword() {
  const field = byId("target-secret");
  const valid = field.value.length >= 12 && new TextEncoder().encode(field.value).length <= 72;
  if (!valid) status("A palavra-passe deve ter pelo menos 12 caracteres e até 72 bytes.");
  return valid;
}

byId("permission-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const target = byId("target");
  const code = target.value.trim();
  const password = byId("target-secret").value;
  if (target.readOnly && password) return status("Para trocar a palavra-passe, usa Redefinir palavra-passe.");
  if (!target.readOnly && !validPassword()) return;
  const role = byId("target-role").value;
  const scopes = role === "colaborador" ? [] : Array.from(byId("scope-list").querySelectorAll("input:checked"), box => box.value);
  const active = byId("target-active").checked;
  const button = event.submitter;
  button.disabled = true;
  try {
    const result = target.readOnly
      ? await db.from("compass_tiers").update({ role, scopes, active }).eq("code", code).select("code").single()
      : await db.functions.invoke("compass-account", { body: { action: "create", code, role, scopes, active, password } });
    if (result.error) return status("Não foi possível guardar. Confirma o código e as permissões escolhidas.");
    byId("permission-form").reset();
    await loadPermissions();
    status("Acesso guardado.");
  } catch {
    status("Não foi possível guardar o acesso.");
  } finally { button.disabled = false; }
});

byId("target-reset").onclick = async () => {
  if (!validPassword()) return;
  const button = byId("target-reset");
  button.disabled = true;
  try {
    const result = await db.functions.invoke("compass-account", { body: {
      action: "reset", code: byId("target").value, password: byId("target-secret").value,
    } });
    if (result.error) return status("Não foi possível redefinir a palavra-passe.");
    byId("target-secret").value = "";
    status("Palavra-passe redefinida.");
  } catch {
    status("Não foi possível redefinir a palavra-passe.");
  } finally { button.disabled = false; }
};

byId("permission-form").addEventListener("reset", () => {
  byId("target").readOnly = false;
  updatePasswordField(false);
  queueMicrotask(updateScopeFields);
});
byId("target-role").addEventListener("change", updateScopeFields);

function showAccessForm() {
  const settingUp = Boolean(setupToken);
  byId("auth-title").textContent = settingUp ? "Ativar Admin 41" : "Entrar";
  byId("auth-submit").textContent = settingUp ? "Ativar acesso" : "Entrar";
  byId("access-help").textContent = settingUp ? "Define a tua palavra-passe com pelo menos 16 caracteres." : "Para obter acesso, contacta o administrador do Talent Compass.";
  byId("code").readOnly = settingUp;
  if (settingUp) byId("code").value = "41";
  byId("password").minLength = settingUp ? 16 : 1;
  byId("password").autocomplete = settingUp ? "new-password" : "current-password";
}
showAccessForm();

byId("auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!db) return status("Não foi possível ligar ao serviço de autenticação.");
  const code = byId("code").value.trim();
  const password = byId("password").value;
  const button = event.submitter;
  button.disabled = true;
  try {
    if (setupToken) {
      if (new TextEncoder().encode(password).length > 72) return status("Escolhe uma palavra-passe de até 72 bytes.");
      const result = await db.functions.invoke("compass-setup", { body: { token: setupToken, password } });
      if (result.error) return status("Não foi possível ativar o código 41. Confirma que o link ainda está válido.");
      setupToken = null;
      showAccessForm();
    }
    const { error } = await db.auth.signInWithPassword({ email: code + identitySuffix, password });
    if (error) return status(error.status === 429 ? "Demasiadas tentativas. Volta a tentar dentro de instantes." : "Confirma o código e a palavra-passe com o administrador.");
    byId("password").value = "";
    await loadDashboard();
  } catch {
    status("Não foi possível ligar ao serviço de autenticação.");
  } finally { button.disabled = false; }
});
byId("nav-exec").onclick = () => openSection("exec");
for (const button of byId("dashboard").querySelectorAll("[data-section]")) button.onclick = () => openSection(button.dataset.section);
byId("nav-locations").onclick = () => openSection("locations");
byId("nav-admin").onclick = () => openSection("admin");
byId("scope").onchange = () => renderReport(byId("scope").value);
byId("logout").onclick = async () => {
  await db.auth.signOut();
  clearDashboard();
  status();
};
function theme(selected) {
  document.documentElement.dataset.theme = selected;
  byId("theme").textContent = selected === "light" ? "Tema escuro" : "Tema claro";
}
theme(localStorage.getItem("g11-compass-theme") === "light" ? "light" : "dark");
byId("theme").onclick = () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("g11-compass-theme", next);
  theme(next);
};
if (!db) status("Serviço de autenticação indisponível.");
else {
  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") clearDashboard();
    if (event === "INITIAL_SESSION") setTimeout(loadDashboard, 0);
  });
}

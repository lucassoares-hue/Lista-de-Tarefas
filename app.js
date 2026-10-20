/* ==========================================================================
   Lógica principal - Dashboard de Pendências - Sistema GGE
   ========================================================================== */

let allRows = []; // todas as linhas, já em formato canônico
let isLoadingData = false; // evita requisições simultâneas
let dataLoaded = false; // true após uma carga bem-sucedida (mesmo que vazia)

const SPLASH_MIN_DURATION_MS = 1500;
const splashStartTime = Date.now();

const AUTH_STORAGE_KEY = "sgge_auth";
const ACCESS_PASSWORD = "gge@123";

document.addEventListener("DOMContentLoaded", () => {
  checkAuth();
  bindPasswordForm();
  try {
    initCharts();
  } catch (err) {
    // Uma falha nos gráficos não pode impedir o carregamento dos dados.
    console.error("Falha ao inicializar os gráficos:", err);
  }
  bindFilterEvents();
  bindCardEvents();
  bindTempoModal();
  bindRelatorioModal();
  bindRetryButton();
  loadData();
});

function bindRetryButton() {
  const retryBtn = document.getElementById("btn-retry");
  if (retryBtn) retryBtn.addEventListener("click", () => loadData());
}

/**
 * Verifica se o acesso já foi liberado nesta sessão (sessionStorage).
 * Caso não esteja liberado, mantém a tela de senha visível.
 */
function checkAuth() {
  const passwordScreen = document.getElementById("password-screen");
  if (!passwordScreen) return;

  if (sessionStorage.getItem(AUTH_STORAGE_KEY) === "true") {
    passwordScreen.style.display = "none";
  }
}

/**
 * Liga o formulário da tela de senha: valida a senha digitada,
 * libera o acesso (sessionStorage) e esconde a tela de senha.
 */
function bindPasswordForm() {
  const form = document.getElementById("password-form");
  const input = document.getElementById("password-input");
  const error = document.getElementById("password-error");
  const passwordScreen = document.getElementById("password-screen");
  if (!form || !input || !passwordScreen) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    if (input.value === ACCESS_PASSWORD) {
      sessionStorage.setItem(AUTH_STORAGE_KEY, "true");
      if (error) error.classList.remove("visible");
      passwordScreen.classList.add("password-hidden");
      setTimeout(() => {
        passwordScreen.style.display = "none";
      }, 400);
    } else {
      if (error) error.classList.add("visible");
      input.value = "";
      input.focus();
    }
  });
}

/**
 * Esconde a splash screen inicial com fade-out, respeitando um tempo
 * mínimo de exibição (SPLASH_MIN_DURATION_MS) para evitar um "flash"
 * caso os dados carreguem muito rápido.
 */
function hideSplashScreen() {
  const splash = document.getElementById("splash-screen");
  if (!splash) return;

  const elapsed = Date.now() - splashStartTime;
  const remaining = Math.max(0, SPLASH_MIN_DURATION_MS - elapsed);

  setTimeout(() => {
    splash.classList.add("splash-hidden");
  }, remaining);
}

/* --------------------------------------------------------------------- */
/* Carregamento dos dados                                                  */
/* --------------------------------------------------------------------- */

/** Erro de carga com uma mensagem amigável (interface) e detalhes técnicos (console). */
class LoadError extends Error {
  constructor(kind, userMessage, details) {
    super(userMessage);
    this.kind = kind;
    this.details = details;
  }
}

/** Faz o GET da API com timeout (FETCH_TIMEOUT_MS), sempre limpando o temporizador. */
async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new LoadError(
        "timeout",
        `A fonte de dados não respondeu em ${Math.round(timeoutMs / 1000)} segundos.`,
        err
      );
    }
    // O navegador não distingue falha de rede de bloqueio por CORS: ambos geram TypeError.
    throw new LoadError(
      "network",
      "Não foi possível conectar à fonte de dados (falha de rede, endereço inválido ou acesso bloqueado pelo navegador).",
      err
    );
  } finally {
    clearTimeout(timer);
  }
}

async function loadData() {
  if (isLoadingData) return;
  isLoadingData = true;

  showLoading(true);
  hideMessage();
  setRetryDisabled(true);

  try {
    const response = await fetchWithTimeout(API_URL, FETCH_TIMEOUT_MS);

    if (!response.ok) {
      throw new LoadError(
        "http",
        `A fonte de dados respondeu com erro (HTTP ${response.status}).`,
        `HTTP ${response.status} ${response.statusText} - ${response.url}`
      );
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (e) {
      const looksLikeHtml = /^\s*</.test(text);
      throw new LoadError(
        "parse",
        looksLikeHtml
          ? "A fonte de dados retornou uma página HTML em vez de dados (possível página de login ou endereço incorreto)."
          : "A fonte de dados retornou uma resposta que não é um JSON válido.",
        `Content-Type: ${response.headers.get("content-type")}; início: ${text.slice(0, 200)}`
      );
    }

    let rawRows;
    if (Array.isArray(payload)) {
      rawRows = payload;
    } else if (payload && typeof payload === "object") {
      if (payload.ok === false) {
        throw new LoadError(
          "api",
          `A fonte de dados informou um erro: ${payload.message || payload.error || "sem detalhes"}.`,
          payload
        );
      }
      rawRows =
        payload.dados ||
        payload.data ||
        payload.rows ||
        payload.result ||
        payload.tarefas ||
        payload.items ||
        [];
    } else {
      rawRows = [];
    }

    if (!Array.isArray(rawRows)) {
      throw new LoadError(
        "structure",
        "A fonte de dados respondeu, mas em um formato inesperado.",
        payload
      );
    }

    allRows = rawRows.map(toCanonicalRow);
    dataLoaded = true;

    if (allRows.length === 0) {
      showMessage("A fonte de dados foi consultada com sucesso, mas não há registros cadastrados.", "warning");
    }

    populateFilters(allRows);
    applyFilters();
  } catch (err) {
    console.error("[SGGE] Falha ao carregar os dados:", err.kind || "unexpected", err.details || "", err);
    const message = err instanceof LoadError ? err.message : "Ocorreu um erro inesperado ao processar os dados.";
    showMessage(`Não foi possível carregar os dados do SGGE. ${message}`, "error", { retry: true });
    // Mantém os dados de uma carga anterior bem-sucedida; senão, limpa o painel.
    if (!dataLoaded) clearDashboard();
  } finally {
    isLoadingData = false;
    setRetryDisabled(false);
    showLoading(false);
    hideSplashScreen();
  }
}

/* --------------------------------------------------------------------- */
/* Filtros                                                                 */
/* --------------------------------------------------------------------- */

function populateFilters(rows) {
  FILTER_FIELDS.forEach(({ id, field, label }) => {
    const select = document.getElementById(id);
    if (!select) return;

    const previousValue = select.value;
    const values = uniqueSorted(rows.map((row) => row[field]));

    select.innerHTML = "";

    // Opção placeholder (oculta na lista, exibida quando nada está selecionado)
    const optionPlaceholder = document.createElement("option");
    optionPlaceholder.value = "";
    optionPlaceholder.disabled = true;
    optionPlaceholder.hidden = true;
    optionPlaceholder.textContent = label;
    select.appendChild(optionPlaceholder);

    const optionAll = document.createElement("option");
    optionAll.value = "";
    optionAll.textContent = "Todos";
    select.appendChild(optionAll);

    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });

    if (values.includes(previousValue) && previousValue !== "") {
      select.value = previousValue;
    } else {
      select.value = "";
    }
  });
}

function bindFilterEvents() {
  FILTER_FIELDS.forEach(({ id }) => {
    const select = document.getElementById(id);
    if (select) select.addEventListener("change", applyFilters);
  });

  const situacaoSelect = document.getElementById("filter-situacao");
  if (situacaoSelect) situacaoSelect.addEventListener("change", applyFilters);

  const clearBtn = document.getElementById("btn-clear-filters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      FILTER_FIELDS.forEach(({ id }) => {
        const select = document.getElementById(id);
        if (select) select.value = "";
      });
      if (situacaoSelect) situacaoSelect.value = "";
      applyFilters();
    });
  }
}

function getActiveFilters() {
  const filters = {};
  FILTER_FIELDS.forEach(({ id, field }) => {
    const select = document.getElementById(id);
    const value = select ? select.value : "";
    if (isFilled(value)) filters[field] = value;
  });
  return filters;
}

/**
 * Estado único da situação ("", "pendentes" ou "resolvidas"): o próprio
 * <select id="filter-situacao">, compartilhado com os cards.
 */
function getSituacao() {
  const select = document.getElementById("filter-situacao");
  return select ? select.value : "";
}

function setSituacao(value) {
  const select = document.getElementById("filter-situacao");
  if (select) select.value = value;
  applyFilters();
}

function matchesSituacao(row, situacao) {
  if (situacao === "pendentes") {
    return PENDING_STATUSES.includes(normalizeStatus(row.status));
  }
  if (situacao === "resolvidas") {
    return normalizeStatus(row.status) === RESOLVED_STATUS;
  }
  return true;
}

function applyFilters() {
  const filters = getActiveFilters();
  const situacao = getSituacao();

  // Recorte pelos demais filtros (antes da situação): base dos cards de contagem.
  const baseRows = allRows.filter((row) =>
    Object.entries(filters).every(([field, value]) => normalizeText(row[field]) === value)
  );
  // Recorte exibido: base + situação selecionada.
  const filteredRows = baseRows.filter((row) => matchesSituacao(row, situacao));

  updateDashboard(baseRows, filteredRows);
  updateCardSelection(situacao);
}

/* --------------------------------------------------------------------- */
/* Cards interativos                                                       */
/* --------------------------------------------------------------------- */

function bindCardEvents() {
  document.querySelectorAll(".card-action[data-situacao]").forEach((card) => {
    card.addEventListener("click", () => {
      const target = card.dataset.situacao;
      // Segundo clique no card ativo remove a seleção; "Total" sempre limpa.
      setSituacao(target !== "" && getSituacao() === target ? "" : target);
    });
  });
}

function updateCardSelection(situacao) {
  document.querySelectorAll(".card-action[data-situacao]").forEach((card) => {
    card.setAttribute("aria-pressed", String(card.dataset.situacao === situacao));
  });
}

/* --------------------------------------------------------------------- */
/* Atualização do dashboard (cards, gráficos e tabela)                    */
/* --------------------------------------------------------------------- */

function isValidRow(row) {
  return isFilled(row.solicitante);
}

let lastTempoStats = { average: null, items: [] }; // base do card e do modal de tempo médio

/**
 * `baseRows`: recorte pelos filtros de dimensão (sem a situação).
 * `rows`: recorte exibido (com a situação), usado em gráficos, tabela e tempo médio.
 */
function updateDashboard(baseRows, rows) {
  const validRows = rows.filter(isValidRow);

  updateCards(baseRows, rows);
  updateCharts(validRows);
  updateTable(rows);
}

/**
 * Tempo médio de resolução: média de dias entre data_inicio e data_termino
 * das linhas com as duas datas válidas. Retorna também os itens usados,
 * para o modal de detalhamento usar exatamente o mesmo conjunto.
 */
function computeAverageResolution(rows) {
  const items = [];
  rows.forEach((row) => {
    if (!isFilled(row.data_inicio) || !isFilled(row.data_termino)) return;
    const start = parseBRDate(row.data_inicio);
    const end = parseBRDate(row.data_termino);
    if (!start || !end) return;
    items.push({ row, days: diffInDays(start, end) });
  });
  const average = items.length
    ? items.reduce((sum, item) => sum + item.days, 0) / items.length
    : null;
  return { average, items };
}

function updateCards(baseRows, rows) {
  // 1. Total de Erros Reportados: solicitante preenchido (recorte sem situação)
  document.getElementById("card-total-erros").textContent = baseRows.filter(isValidRow).length;

  // 2. Tarefas Pendentes: status "NO PRAZO" ou "ATRASADO" (recorte sem situação)
  const pendentes = baseRows.filter((row) => matchesSituacao(row, "pendentes")).length;
  document.getElementById("card-pendentes").textContent = pendentes;

  // 3. Tempo Médio de Resolução: acompanha o recorte exibido
  lastTempoStats = computeAverageResolution(rows);
  document.getElementById("card-tempo-medio").textContent =
    lastTempoStats.average === null ? "-" : formatDays(lastTempoStats.average);

  // 4. Tarefas Resolvidas: status "RESOLVIDO" (recorte sem situação)
  const resolvidas = baseRows.filter((row) => matchesSituacao(row, "resolvidas")).length;
  document.getElementById("card-resolvidas").textContent = resolvidas;
}

/* --------------------------------------------------------------------- */
/* Modal: detalhamento do tempo médio                                      */
/* --------------------------------------------------------------------- */

function bindTempoModal() {
  const modal = document.getElementById("tempo-modal");
  const opener = document.getElementById("btn-tempo-detalhe");
  if (!modal || !opener) return;

  opener.addEventListener("click", () => {
    renderTempoModal();
    modal.showModal();
    modal.querySelector(".modal-close").focus();
  });

  modal.querySelectorAll("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => modal.close())
  );
  // Esc dispara "cancel" + "close"; o foco volta ao card que abriu o modal.
  modal.addEventListener("close", () => opener.focus());
}

/* --------------------------------------------------------------------- */
/* Modal: relatório de tarefas pendentes                                   */
/* --------------------------------------------------------------------- */

let reportBaseRows = []; // pendentes do recorte no momento em que o relatório foi aberto

const REPORT_FILTERS = [
  { id: "relatorio-f-status", field: "status", label: "Status: todos" },
  { id: "relatorio-f-prioridade", field: "prioridade", label: "Prioridade: todas" },
  { id: "relatorio-f-responsavel", field: "responsavel", label: "Responsável: todos" },
  { id: "relatorio-f-escola", field: "escola", label: "Escola: todas" }
];

const REPORT_SEARCH_FIELDS = ["codigo", "escola", "frente", "responsavel", "categoria", "subcategoria", "descricao"];

/**
 * Pendentes (mesma regra de matchesSituacao) dentro do recorte dos filtros
 * dimensionais. Ignora a seleção de situação e o filtro de status individual.
 */
function getPendingReportRows() {
  const filters = getActiveFilters();
  delete filters.status;
  return allRows.filter(
    (row) =>
      Object.entries(filters).every(([field, value]) => normalizeText(row[field]) === value) &&
      matchesSituacao(row, "pendentes")
  );
}

/** Ordem da prioridade (o texto pode vir com emoji, ex.: "🔴URGENTE"). */
function priorityRank(prioridade) {
  const key = normalizeKey(prioridade);
  if (key.includes("urgente")) return 0;
  if (key.includes("alta")) return 1;
  if (key.includes("media")) return 2;
  if (key.includes("baixa")) return 3;
  return 4;
}

/** Prioridade para exibição (modal e PDF): rótulo sem emoji + chave de cor. */
function getPriorityInfo(prioridade) {
  const keys = ["urgente", "alta", "media", "baixa"];
  const rank = priorityRank(prioridade);
  return { label: priorityLabel(prioridade), key: rank < 4 ? keys[rank] : "outra" };
}

/** Status para exibição (modal e PDF). */
function getStatusInfo(status) {
  const label = normalizeStatus(status);
  return { label, late: label === "ATRASADO" };
}

/** ATRASADO → NO PRAZO; prioridade; prazo mais antigo (vazio/inválido por último); escola. */
function sortReportRows(rows) {
  const statusRank = (row) => (normalizeStatus(row.status) === "ATRASADO" ? 0 : 1);
  return rows
    .map((row) => ({ row, prazo: parseBRDate(row.prazo) }))
    .sort((a, b) =>
      statusRank(a.row) - statusRank(b.row) ||
      priorityRank(a.row.prioridade) - priorityRank(b.row.prioridade) ||
      (a.prazo ? (b.prazo ? a.prazo - b.prazo : -1) : (b.prazo ? 1 : 0)) ||
      normalizeText(a.row.escola).localeCompare(normalizeText(b.row.escola), "pt-BR")
    )
    .map(({ row }) => row);
}

function bindRelatorioModal() {
  const modal = document.getElementById("relatorio-modal");
  const opener = document.getElementById("btn-relatorio");
  if (!modal || !opener) return;

  opener.addEventListener("click", (event) => {
    event.stopPropagation(); // independente do filtro do card
    openRelatorio();
    modal.showModal();
    modal.querySelector(".modal-close").focus();
  });

  modal.querySelectorAll("[data-close-modal]").forEach((btn) =>
    btn.addEventListener("click", () => modal.close())
  );
  modal.addEventListener("close", () => opener.focus());

  REPORT_FILTERS.forEach(({ id }) => {
    const select = document.getElementById(id);
    if (select) select.addEventListener("change", renderRelatorio);
  });
  const search = document.getElementById("relatorio-busca");
  if (search) search.addEventListener("input", renderRelatorio);

  const clearBtn = document.getElementById("relatorio-limpar");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      resetRelatorioFilters();
      renderRelatorio();
    });
  }

  const pdfBtn = document.getElementById("relatorio-pdf");
  if (pdfBtn) pdfBtn.addEventListener("click", handleReportPdfClick);
}

function resetRelatorioFilters() {
  REPORT_FILTERS.forEach(({ id }) => {
    const select = document.getElementById(id);
    if (select) select.value = "";
  });
  const search = document.getElementById("relatorio-busca");
  if (search) search.value = "";
}

/** Resumo (total, no prazo, atrasadas e % atrasadas) de um conjunto de pendentes. */
function getReportSummary(rows) {
  const atrasadas = rows.filter((row) => getStatusInfo(row.status).late).length;
  const total = rows.length;
  const percentAtrasadas = total > 0 ? Math.round((atrasadas / total) * 100) : 0;
  return {
    total,
    atrasadas,
    noPrazo: total - atrasadas,
    percentAtrasadas,
    percentNoPrazo: total > 0 ? 100 - percentAtrasadas : 0
  };
}

/** Texto da faixa "Filtros:" (só filtros aplicados; senão, todos os registros). */
function getReportFiltersText(mainFilters) {
  return mainFilters.length
    ? mainFilters.map(({ label, value }) => `${label}: ${value}`).join(" • ")
    : "Todos os registros pendentes";
}

function formatPendenciasCount(total) {
  return `${total} pendência${total === 1 ? "" : "s"} neste relatório`;
}

/** Filtros principais (dimensionais) ativos que formam o recorte do relatório. */
function getReportMainFilters() {
  const filtros = getActiveFilters();
  delete filtros.status;
  return FILTER_FIELDS.filter(({ field }) => filtros[field]).map(({ field, label }) => ({
    field,
    label,
    value: filtros[field]
  }));
}

/** Filtros internos e busca ativos no relatório (para o PDF registrar o recorte exportado). */
function getReportInternalFilters() {
  const entries = [];
  REPORT_FILTERS.forEach(({ id, label }) => {
    const select = document.getElementById(id);
    if (select && isFilled(select.value)) entries.push({ label: label.split(":")[0], value: select.value });
  });
  const search = document.getElementById("relatorio-busca");
  if (search && isFilled(search.value)) entries.push({ label: "Busca", value: `"${normalizeText(search.value)}"` });
  return entries;
}

function formatDateTimeBR(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
  };
}

/** Rótulo da prioridade sem emoji (ex.: "🔴URGENTE" → "URGENTE"); mantém o texto original se desconhecido. */
function priorityLabel(prioridade) {
  const labels = ["URGENTE", "ALTA", "MÉDIA", "BAIXA"];
  const rank = priorityRank(prioridade);
  return rank < 4 ? labels[rank] : normalizeText(prioridade);
}

function renderRelatorioHeader(summary) {
  const { date, time } = formatDateTimeBR(new Date());
  const set = (id, text) => (document.getElementById(id).textContent = text);

  set("relatorio-gerado", `Gerado em ${date} às ${time}`);
  set("relatorio-qtd", formatPendenciasCount(summary.total));
  set("relatorio-total", summary.total);
  set("relatorio-sum-total", summary.total);
  set("relatorio-sum-noprazo", summary.noPrazo);
  set("relatorio-sum-atrasado", summary.atrasadas);

  // Rosca: arco vermelho proporcional às atrasadas; restante em azul (no prazo)
  const late = summary.percentAtrasadas;
  document.getElementById("relatorio-donut").style.background = summary.total
    ? `conic-gradient(var(--red) 0 ${late}%, var(--blue-light) ${late}% 100%)`
    : "var(--track-bg)";
  set("relatorio-donut-label", `${late}%`);
  set("relatorio-percent", `${late}% das pendências estão atrasadas`);
  document.getElementById("relatorio-bar-noprazo").style.width = `${summary.percentNoPrazo}%`;
  document.getElementById("relatorio-bar-atrasado").style.width = `${late}%`;
  set("relatorio-legend-noprazo", `${summary.percentNoPrazo}% no prazo (${summary.noPrazo})`);
  set("relatorio-legend-atrasado", `${late}% atrasadas (${summary.atrasadas})`);

  set("relatorio-filtros", getReportFiltersText(getReportMainFilters()));
}

/** Monta a base do relatório e o resumo; os filtros internos começam limpos. */
function openRelatorio() {
  reportBaseRows = sortReportRows(getPendingReportRows());
  renderRelatorioHeader(getReportSummary(reportBaseRows));
  syncReportPdfButton();

  REPORT_FILTERS.forEach(({ id, field, label }) => {
    const select = document.getElementById(id);
    if (!select) return;
    select.innerHTML = "";
    const optionAll = document.createElement("option");
    optionAll.value = "";
    optionAll.textContent = label;
    select.appendChild(optionAll);
    uniqueSorted(reportBaseRows.map((row) => row[field])).forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  });
  resetRelatorioFilters();
  renderRelatorio();
}

function getRelatorioVisibleRows() {
  const selected = {};
  REPORT_FILTERS.forEach(({ id, field }) => {
    const select = document.getElementById(id);
    if (select && isFilled(select.value)) selected[field] = select.value;
  });
  const search = document.getElementById("relatorio-busca");
  const term = normalizeKey(search ? search.value : "");

  return reportBaseRows.filter(
    (row) =>
      Object.entries(selected).every(([field, value]) => normalizeText(row[field]) === value) &&
      (!term || REPORT_SEARCH_FIELDS.some((field) => normalizeKey(row[field]).includes(term)))
  );
}

function renderRelatorio() {
  const content = document.getElementById("relatorio-content");
  const countLabel = document.getElementById("relatorio-count");

  if (reportBaseRows.length === 0) {
    countLabel.textContent = "";
    content.innerHTML = `<div class="modal-empty">Nenhuma tarefa pendente encontrada para os filtros selecionados.</div>`;
    return;
  }

  const rows = getRelatorioVisibleRows();
  countLabel.textContent = `Exibindo ${rows.length} de ${reportBaseRows.length} tarefa${reportBaseRows.length === 1 ? "" : "s"} pendente${reportBaseRows.length === 1 ? "" : "s"}.`;

  if (rows.length === 0) {
    content.innerHTML = `<div class="modal-empty">Nenhuma tarefa pendente corresponde à busca ou aos filtros do relatório.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="table-wrapper report-table-wrapper">
      <table class="report-table">
        <thead>
          <tr>
            <th class="col-sm">Código</th><th class="col-lg">Escola</th><th class="col-sm">Coleção / Módulo</th>
            <th>Ano / Frente</th><th>Categoria / Subcategoria</th><th class="col-sm">Prioridade</th>
            <th class="col-md">Responsável</th><th class="col-sm">Prazo</th><th class="col-sm">Status</th>
            <th class="col-desc">Descrição do problema</th>
          </tr>
        </thead>
        <tbody>${rows.map(renderRelatorioRow).join("")}</tbody>
      </table>
    </div>`;
  bindReportLogoFallback(content);
}

const REPORT_STATUS_ICONS = {
  late: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>`
};

function renderRelatorioRow(row) {
  const text = (value) => escapeHtml(isFilled(value) ? value : "-");
  const cell = (value, cls = "") => `<td${cls ? ` class="${cls}"` : ""}>${text(value)}</td>`;
  const stack = (a, b) =>
    `<td class="report-cell-stack"><span>${text(a)}</span>${isFilled(b) ? `<span>${escapeHtml(b)}</span>` : ""}</td>`;
  const status = getStatusInfo(row.status);
  const priority = getPriorityInfo(row.prioridade);
  const prioridade = isFilled(row.prioridade)
    ? `<span class="report-priority priority-${priority.key}">${escapeHtml(priority.label)}</span>`
    : "-";
  const colecaoModulo = [row.colecao, row.modulo].filter(isFilled).join(" / ");
  return `
    <tr class="${status.late ? "report-row-atrasado" : "report-row-noprazo"}">
      ${cell(row.codigo, "col-sm")}
      <td class="col-lg">${renderReportSchoolCell(row)}</td>
      ${cell(colecaoModulo, "col-sm")}
      ${stack(row.ano, row.frente)}
      ${stack(row.categoria, row.subcategoria)}
      <td class="col-sm">${prioridade}</td>
      ${cell(row.responsavel, "col-md")}${cell(row.prazo, "col-sm")}
      <td class="col-sm"><span class="report-status report-status-${status.late ? "late" : "ok"}">${REPORT_STATUS_ICONS[status.late ? "late" : "ok"]}${escapeHtml(status.label)}</span></td>
      <td class="cell-descricao col-desc">${escapeHtml(row.descricao)}</td>
    </tr>`;
}

/** Logo da escola (escola_imagem) + nome; sem imagem → iniciais. */
function renderReportSchoolCell(row) {
  const escola = isFilled(row.escola) ? row.escola : "Não informado";
  const initials = escapeHtml(getInitials(escola));
  const logo = isFilled(row.escola_imagem)
    ? `<img class="report-school-logo" src="${escapeHtml(row.escola_imagem)}" alt="" data-initials="${initials}" loading="lazy">`
    : `<span class="report-school-logo report-school-initials" aria-hidden="true">${initials}</span>`;
  return `<div class="report-school">${logo}<span>${escapeHtml(escola)}</span></div>`;
}

/** Troca logos que falharem ao carregar pelo placeholder de iniciais (sem ícone quebrado). */
function bindReportLogoFallback(container) {
  container.querySelectorAll("img.report-school-logo").forEach((img) => {
    img.addEventListener(
      "error",
      () => {
        const span = document.createElement("span");
        span.className = "report-school-logo report-school-initials";
        span.setAttribute("aria-hidden", "true");
        span.textContent = img.dataset.initials || "?";
        img.replaceWith(span);
      },
      { once: true }
    );
  });
}

/* --------------------------------------------------------------------- */
/* Exportação do relatório em PDF (montagem em report-pdf.js)             */
/* --------------------------------------------------------------------- */

let isGeneratingPdf = false;

function setReportPdfError(message) {
  const el = document.getElementById("relatorio-pdf-erro");
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

/** Habilita o GERAR PDF só com as bibliotecas locais disponíveis; o alerta aparece apenas em falha real. */
function syncReportPdfButton() {
  const btn = document.getElementById("relatorio-pdf");
  const { error } = getReportPdfLibrary();
  if (btn) btn.disabled = Boolean(error);
  setReportPdfError(error || "");
  if (error) console.error("[SGGE] Exportação em PDF indisponível:", error);
}

/** Dados exatamente como exibidos no modal (filtros principais, internos e busca). */
function collectReportPdfData() {
  const rows = reportBaseRows.length ? getRelatorioVisibleRows() : [];
  return {
    rows,
    summary: getReportSummary(rows),
    mainFilters: getReportMainFilters(),
    internalFilters: getReportInternalFilters(),
    generatedAt: new Date()
  };
}

async function handleReportPdfClick() {
  if (isGeneratingPdf) return;
  const btn = document.getElementById("relatorio-pdf");
  isGeneratingPdf = true;
  btn.disabled = true;
  btn.textContent = "Gerando PDF...";
  setReportPdfError("");
  try {
    await exportReportPdf(collectReportPdfData());
  } catch (err) {
    console.error("[SGGE] Falha ao gerar o PDF:", err);
    setReportPdfError(
      err && err.userMessage
        ? err.userMessage
        : "Não foi possível gerar o PDF. Tente novamente; se o problema continuar, recarregue a página."
    );
  } finally {
    isGeneratingPdf = false;
    btn.disabled = Boolean(getReportPdfLibrary().error);
    btn.textContent = "GERAR PDF";
  }
}

function renderTempoModal() {
  const { average, items } = lastTempoStats;
  document.getElementById("tempo-modal-media").textContent =
    average === null ? "-" : formatDays(average);
  document.getElementById("tempo-modal-qtd").textContent = items.length;

  const content = document.getElementById("tempo-modal-content");
  if (items.length === 0) {
    content.innerHTML = `<div class="modal-empty">Não existem dados suficientes para calcular a média no recorte atual.</div>`;
    return;
  }

  const sum = items.reduce((acc, item) => acc + item.days, 0);
  const avgExact = (sum / items.length).toFixed(2).replace(".", ",");
  const bodyRows = items
    .map(
      ({ row, days }) => `
      <tr>
        <td>${escapeHtml(row.codigo || "-")}</td>
        <td>${escapeHtml(row.data_inicio)}</td>
        <td>${escapeHtml(row.data_termino)}</td>
        <td>${formatDays(days)}</td>
      </tr>`
    )
    .join("");

  content.innerHTML = `
    <p class="modal-rule">Soma: ${sum} dias ÷ ${items.length} registro${items.length === 1 ? "" : "s"} = ${avgExact} → exibido como <strong>${formatDays(sum / items.length)}</strong>.</p>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr><th>Código</th><th>Data de início</th><th>Data de término</th><th>Duração considerada</th></tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>`;
}

/* --------------------------------------------------------------------- */
/* Tabela detalhada                                                        */
/* --------------------------------------------------------------------- */

function updateTable(rows) {
  const tbody = document.getElementById("table-body");
  const countLabel = document.getElementById("table-count");
  tbody.innerHTML = "";

  if (rows.length === 0) {
    let emptyText = "Nenhum registro encontrado para os filtros selecionados.";
    if (!dataLoaded) emptyText = "Dados indisponíveis: a fonte de dados não pôde ser carregada.";
    else if (allRows.length === 0) emptyText = "Nenhum registro cadastrado na fonte de dados.";
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="11" class="table-empty">${emptyText}</td>`;
    tbody.appendChild(tr);
    countLabel.textContent = "0 registros";
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const escola = isFilled(row.escola) ? row.escola : "Não informado";
    const imagem = isFilled(row.escola_imagem) ? row.escola_imagem : "";
    const initials = getInitials(escola);

    const resolutionDays = getResolutionDays(row);
    let resolutionCell = "-";
    if (resolutionDays !== null) {
      const alertIcon =
        resolutionDays > 5
          ? `<span class="resolution-alert" title="Tempo de resolução acima de 5 dias">●</span>`
          : "";
      resolutionCell = `${formatDays(resolutionDays)}${alertIcon}`;
    }

    const imagemLink = isFilled(row.link_imagem)
      ? `<a class="table-link-btn" href="${escapeHtml(row.link_imagem)}" target="_blank" rel="noopener noreferrer">Ver imagem</a>`
      : "-";

    tr.innerHTML = `
      <td>
        <div class="table-school-cell">
          ${
            imagem
              ? `<img class="table-school-logo" src="${escapeHtml(imagem)}" alt="Logo de ${escapeHtml(escola)}" onerror="this.replaceWith(createTableSchoolPlaceholder('${escapeHtml(initials)}'))">`
              : `<div class="table-school-logo table-school-logo-placeholder">${escapeHtml(initials)}</div>`
          }
          <span class="table-school-name" title="${escapeHtml(escola)}">${escapeHtml(escola)}</span>
        </div>
      </td>
      <td>${escapeHtml(row.colecao)}</td>
      <td>${escapeHtml(row.modulo)}</td>
      <td>${escapeHtml(row.ano)}</td>
      <td>${escapeHtml(row.frente)}</td>
      <td>${escapeHtml(row.categoria)}</td>
      <td>${escapeHtml(row.prioridade)}</td>
      <td>${resolutionCell}</td>
      <td><span class="${statusBadgeClass(row.status)}">${escapeHtml(row.status || "-")}</span></td>
      <td class="cell-descricao">${escapeHtml(row.descricao)}</td>
      <td>${imagemLink}</td>
    `;
    fragment.appendChild(tr);
  });

  tbody.appendChild(fragment);
  countLabel.textContent = `${rows.length} registro${rows.length === 1 ? "" : "s"}`;
}

/* --------------------------------------------------------------------- */
/* Mensagens de estado / erro                                              */
/* --------------------------------------------------------------------- */

function showLoading(isLoading) {
  const el = document.getElementById("loading-indicator");
  if (el) el.style.display = isLoading ? "flex" : "none";
}

function showMessage(text, type, { retry = false } = {}) {
  const el = document.getElementById("status-message");
  if (!el) return;
  document.getElementById("status-message-text").textContent = text;
  document.getElementById("btn-retry").style.display = retry ? "inline-block" : "none";
  el.className = `status-message status-${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.style.display = "flex";
}

function hideMessage() {
  const el = document.getElementById("status-message");
  if (!el) return;
  el.style.display = "none";
  document.getElementById("status-message-text").textContent = "";
  document.getElementById("btn-retry").style.display = "none";
  el.className = "status-message";
}

function setRetryDisabled(disabled) {
  const btn = document.getElementById("btn-retry");
  if (btn) btn.disabled = disabled;
}

function clearDashboard() {
  ["card-total-erros", "card-pendentes", "card-tempo-medio", "card-resolvidas"].forEach(
    (id) => {
      document.getElementById(id).textContent = "-";
    }
  );
  updateCharts([]);
  updateTable([]);
}

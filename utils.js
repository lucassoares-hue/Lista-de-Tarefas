/* ==========================================================================
   Funções utilitárias - Dashboard de Pendências - Sistema GGE
   ========================================================================== */

/**
 * Remove acentos, espaços e caracteres especiais e converte para minúsculas.
 * Usado para comparar nomes de colunas/campos vindos da planilha.
 */
function normalizeKey(str) {
  return String(str ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .replace(/[^a-z0-9]/g, "");
}

/** Remove espaços extras nas pontas e garante string. */
function normalizeText(value) {
  return String(value ?? "").trim();
}

/** Normaliza um status para comparação (maiúsculas, espaços únicos). */
function normalizeStatus(value) {
  return normalizeText(value).toUpperCase().replace(/\s+/g, " ");
}

/** Verifica se um valor está preenchido (não vazio após trim). */
function isFilled(value) {
  return normalizeText(value) !== "";
}

/**
 * Converte uma linha bruta vinda da API (objeto com chaves arbitrárias)
 * em um índice cujas chaves são normalizadas (sem acento/espaço/maiúscula).
 */
function buildRowIndex(row) {
  const idx = {};
  Object.keys(row || {}).forEach((key) => {
    idx[normalizeKey(key)] = row[key];
  });
  return idx;
}

/** Busca o valor de um campo canônico em um índice de linha já normalizado. */
function getField(rowIndex, canonical) {
  const aliases = FIELD_ALIASES[canonical] || [canonical];
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(rowIndex, alias)) {
      return rowIndex[alias];
    }
  }
  return "";
}

/**
 * Converte uma linha bruta da API em um objeto canônico simples,
 * com todos os campos conhecidos como string já normalizada (trim).
 */
function toCanonicalRow(row) {
  const idx = buildRowIndex(row);
  const out = {};
  Object.keys(FIELD_ALIASES).forEach((field) => {
    out[field] = normalizeText(getField(idx, field));
  });
  return out;
}

/**
 * Faz o parse de uma data no formato brasileiro dd/mm/aaaa (ou d/m/aa).
 * Também tenta o formato ISO (aaaa-mm-dd) como alternativa.
 * Retorna um objeto Date ou null se não for possível interpretar.
 */
function parseBRDate(value) {
  const str = normalizeText(value);
  if (!str) return null;

  const brMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (brMatch) {
    let [, day, month, year] = brMatch;
    if (year.length === 2) year = "20" + year;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(date.getTime())) return date;
    return null;
  }

  const isoMatch = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!isNaN(date.getTime())) return date;
    return null;
  }

  return null;
}

/** Diferença em dias (inteiro) entre duas datas. */
function diffInDays(start, end) {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

/** Formata um número de dias respeitando singular/plural. */
function formatDays(value) {
  const rounded = Math.round(value);
  return rounded === 1 ? "1 dia" : `${rounded} dias`;
}

/**
 * Retorna o tempo de resolução (em dias) de uma linha, usando o campo
 * tempo_resolucao quando preenchido ou, caso contrário, calculando a
 * diferença entre data_inicio e data_termino. Retorna null se não for
 * possível determinar.
 */
function getResolutionDays(row) {
  if (isFilled(row.tempo_resolucao)) {
    const parsed = parseFloat(String(row.tempo_resolucao).replace(",", "."));
    if (!isNaN(parsed)) return parsed;
  }

  if (isFilled(row.data_inicio) && isFilled(row.data_termino)) {
    const start = parseBRDate(row.data_inicio);
    const end = parseBRDate(row.data_termino);
    if (start && end) return diffInDays(start, end);
  }

  return null;
}

/** Retorna a lista de valores únicos não vazios, ordenada (pt-BR, numérica). */
function uniqueSorted(values) {
  return Array.from(
    new Set(values.filter((v) => isFilled(v)).map((v) => normalizeText(v)))
  ).sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

/** Retorna a classe CSS de badge correspondente a um status. */
function statusBadgeClass(status) {
  const norm = normalizeStatus(status);
  if (norm === RESOLVED_STATUS) return "badge badge-resolvido";
  if (norm === "ATRASADO") return "badge badge-atrasado";
  if (norm === "NO PRAZO") return "badge badge-noprazo";
  if (!norm) return "badge badge-default";
  return "badge badge-default";
}

/** Conta ocorrências agrupando por uma função de chave, retornando array [{label, value}]. */
function countByGroup(rows, keyFn, defaultLabel = "Não informado") {
  const counts = new Map();
  rows.forEach((row) => {
    let label = keyFn(row);
    label = isFilled(label) ? normalizeText(label) : defaultLabel;
    counts.set(label, (counts.get(label) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
}

/** Escapa texto para inserção segura em HTML. */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

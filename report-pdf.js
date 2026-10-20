/* ==========================================================================
   Exportação em PDF - Relatório de Tarefas Pendentes - Sistema GGE
   Gera o PDF localmente no navegador com jsPDF + jspdf-autotable (vendor/).
   Layout espelha o modal: faixa azul, resumo, indicador de atraso, tabela.
   ========================================================================== */

const REPORT_PDF = {
  logoPath: "assets/gge-logo.png",
  imageTimeoutMs: 4000,
  margin: 10, // mm
  heroHeight: 28,
  colors: {
    blue: [33, 60, 121],
    blueShape: [44, 77, 146],
    blueShape2: [56, 92, 165],
    blueLight: [91, 141, 217],
    blueSoft: [234, 241, 251],
    heroMuted: [205, 216, 235],
    text: [31, 36, 48],
    muted: [107, 114, 128],
    line: [237, 240, 244],
    cardBorder: [228, 232, 238],
    headBg: [238, 242, 248],
    headText: [75, 85, 104],
    track: [233, 238, 245],
    red: [214, 69, 80],
    redSoft: [253, 236, 238],
    green: [46, 157, 106],
    greenSoft: [232, 246, 239],
    pillBg: [243, 245, 248]
  },
  priorityColors: {
    urgente: [214, 69, 80],
    alta: [232, 163, 61],
    media: [91, 141, 217],
    baixa: [166, 166, 166],
    outra: [107, 114, 128]
  }
};

/* --------------------------------------------------------------------- */
/* Imagens (logo GGE e logos das escolas)                                  */
/* --------------------------------------------------------------------- */

/**
 * Carrega uma imagem como PNG (data URL) via fetch + canvas. Retorna null em
 * qualquer falha (CORS, timeout, formato), sem interromper a geração do PDF.
 */
async function loadImageAsPngDataUrl(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let objectUrl = null;
  try {
    const response = await fetch(url, { signal: controller.signal, mode: "cors", credentials: "omit" });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) return null;
    objectUrl = URL.createObjectURL(blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 64;
    canvas.height = img.naturalHeight || 64;
    canvas.getContext("2d").drawImage(img, 0, 0);
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

/** Logo GGE (arquivo local) + logos únicas das escolas exportadas, em paralelo. */
async function loadReportPdfAssets(rows) {
  const urls = Array.from(new Set(rows.map((row) => normalizeText(row.escola_imagem)).filter(Boolean)));
  const [logo, ...schoolImages] = await Promise.all([
    loadImageAsPngDataUrl(REPORT_PDF.logoPath, REPORT_PDF.imageTimeoutMs),
    ...urls.map((url) => loadImageAsPngDataUrl(url, REPORT_PDF.imageTimeoutMs))
  ]);
  const schoolLogos = new Map();
  urls.forEach((url, i) => {
    if (schoolImages[i]) schoolLogos.set(url, schoolImages[i]);
  });
  return { logo, schoolLogos };
}

/* --------------------------------------------------------------------- */
/* Texto e nome do arquivo                                                 */
/* --------------------------------------------------------------------- */

/** Remove emojis/símbolos que as fontes padrão do PDF não desenham. Não altera o dado original. */
function pdfText(value) {
  return normalizeText(value)
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, "")
    .trim();
}

function sanitizeFileNamePart(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Ex.: Relatorio_Pendencias_GGE_LUDUS_2026-10-20.pdf (inclui coleção ou escola, se filtradas). */
function buildReportPdfFileName(mainFilters, date) {
  const pad = (n) => String(n).padStart(2, "0");
  const iso = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const relevant = mainFilters.find((f) => f.field === "colecao") || mainFilters.find((f) => f.field === "escola");
  const part = relevant ? sanitizeFileNamePart(relevant.value) : "";
  return `Relatorio_Pendencias_GGE_${part ? part + "_" : ""}${iso}.pdf`;
}

/* --------------------------------------------------------------------- */
/* Ícones vetoriais simples (equivalentes aos SVGs do modal)               */
/* --------------------------------------------------------------------- */

function pdfIconCalendar(doc, x, y, color) {
  doc.setDrawColor(...color).setLineWidth(0.35);
  doc.roundedRect(x, y + 0.6, 4.4, 4, 0.5, 0.5, "S");
  doc.line(x, y + 1.9, x + 4.4, y + 1.9);
  doc.line(x + 1.2, y, x + 1.2, y + 1.1);
  doc.line(x + 3.2, y, x + 3.2, y + 1.1);
}

function pdfIconDocument(doc, cx, cy, color) {
  doc.setDrawColor(...color).setLineWidth(0.4);
  doc.rect(cx - 1.9, cy - 2.4, 3.8, 4.8, "S");
  doc.line(cx - 1, cy - 0.6, cx + 1, cy - 0.6);
  doc.line(cx - 1, cy + 0.5, cx + 1, cy + 0.5);
  doc.line(cx - 1, cy + 1.5, cx + 0.4, cy + 1.5);
}

function pdfIconCheck(doc, cx, cy, r, color) {
  doc.setDrawColor(...color).setLineWidth(0.4);
  doc.circle(cx, cy, r, "S");
  doc.line(cx - r * 0.45, cy + r * 0.05, cx - r * 0.1, cy + r * 0.4);
  doc.line(cx - r * 0.1, cy + r * 0.4, cx + r * 0.5, cy - r * 0.35);
}

function pdfIconClock(doc, cx, cy, r, color) {
  doc.setDrawColor(...color).setLineWidth(0.4);
  doc.circle(cx, cy, r, "S");
  doc.line(cx, cy, cx, cy - r * 0.6);
  doc.line(cx, cy, cx + r * 0.45, cy + r * 0.3);
}

/* --------------------------------------------------------------------- */
/* Blocos da primeira página                                               */
/* --------------------------------------------------------------------- */

function drawPdfHero(doc, data, assets, pageW) {
  const { colors, margin, heroHeight: h } = REPORT_PDF;
  doc.setFillColor(...colors.blue).rect(0, 0, pageW, h, "F");
  // Formas geométricas sutis (paralelogramos) à direita
  doc.setFillColor(...colors.blueShape);
  doc.triangle(pageW * 0.58, 0, pageW * 0.7, 0, pageW * 0.64, h, "F");
  doc.triangle(pageW * 0.64, h, pageW * 0.7, 0, pageW * 0.76, h, "F");
  doc.setFillColor(...colors.blueShape2);
  doc.triangle(pageW * 0.86, h, pageW * 0.94, 0, pageW, 0, "F");
  doc.triangle(pageW * 0.86, h, pageW, 0, pageW, h, "F");

  let titleX = margin;
  if (assets.logo) {
    const logoH = 11;
    const logoW = Math.min(30, (assets.logo.width / assets.logo.height) * logoH);
    doc.setFillColor(255, 255, 255).roundedRect(margin, 6.5, logoW + 6, logoH + 4, 2, 2, "F");
    doc.addImage(assets.logo.dataUrl, "PNG", margin + 3, 8.5, logoW, logoH);
    titleX = margin + logoW + 12;
  }
  doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(255, 255, 255);
  doc.text("Relatório de Tarefas Pendentes", titleX, 13.5);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...colors.heroMuted);
  doc.text("Acompanhamento das atividades ainda em aberto", titleX, 19.5);

  const { date, time } = formatDateTimeBR(data.generatedAt);
  const metaX = pageW - margin - 60;
  pdfIconCalendar(doc, metaX, 9.2, [255, 255, 255]);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...colors.heroMuted);
  doc.text(`Gerado em ${date} às ${time}`, metaX + 7, 12.6);
  doc.setFont("helvetica", "bold").setTextColor(255, 255, 255);
  doc.text(formatPendenciasCount(data.summary.total), metaX + 7, 18.2);
}

function drawPdfKpiCard(doc, x, y, w, h, { value, label, icon, color, soft }) {
  const { colors } = REPORT_PDF;
  doc.setFillColor(255, 255, 255).setDrawColor(...colors.cardBorder).setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, "FD");
  const cx = x + 10, cy = y + h / 2;
  doc.setFillColor(...soft).circle(cx, cy, 6, "F");
  icon(cx, cy, color);
  doc.setFont("helvetica", "bold").setFontSize(19).setTextColor(...color);
  doc.text(String(value), x + 20, cy + 0.6);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...colors.muted);
  doc.text(label, x + 20, cy + 6);
}

/** Rosca: círculo azul (no prazo) + setor vermelho proporcional (atrasadas) + miolo branco. */
function drawPdfDonut(doc, cx, cy, r, percentLate, hasData) {
  const { colors } = REPORT_PDF;
  doc.setFillColor(...(hasData ? colors.blueLight : colors.track)).circle(cx, cy, r, "F");
  if (hasData && percentLate > 0) {
    doc.setFillColor(...colors.red);
    if (percentLate >= 100) {
      doc.circle(cx, cy, r, "F");
    } else {
      const steps = Math.max(2, Math.ceil(percentLate * 0.72));
      const end = (percentLate / 100) * Math.PI * 2;
      const pts = [];
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (end * i) / steps;
        pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      const segs = [];
      let [px, py] = [cx, cy];
      pts.forEach(([x, y]) => { segs.push([x - px, y - py]); px = x; py = y; });
      doc.lines(segs, cx, cy, [1, 1], "F", true);
    }
  }
  doc.setFillColor(255, 255, 255).circle(cx, cy, r * 0.66, "F");
  doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...colors.red);
  doc.text(`${percentLate}%`, cx, cy + 1.3, { align: "center" });
}

function drawPdfAnalysis(doc, x, y, w, h, summary) {
  const { colors } = REPORT_PDF;
  doc.setFillColor(255, 255, 255).setDrawColor(...colors.cardBorder).setLineWidth(0.25);
  doc.roundedRect(x, y, w, h, 2.5, 2.5, "FD");
  drawPdfDonut(doc, x + 13, y + h / 2, 8.5, summary.percentAtrasadas, summary.total > 0);

  const tx = x + 27, tw = w - 27 - 6;
  doc.setFont("helvetica", "bold").setFontSize(9.5).setTextColor(...colors.text);
  doc.text(`${summary.percentAtrasadas}% das pendências estão atrasadas`, tx, y + 8);
  const barY = y + 11.5, barH = 3;
  doc.setFillColor(...colors.track).roundedRect(tx, barY, tw, barH, 1.5, 1.5, "F");
  if (summary.total > 0) {
    const okW = (tw * summary.percentNoPrazo) / 100;
    if (okW > 0) doc.setFillColor(...colors.blueLight).rect(tx, barY, okW, barH, "F");
    if (tw - okW > 0) doc.setFillColor(...colors.red).rect(tx + okW, barY, tw - okW, barH, "F");
  }
  doc.setFont("helvetica", "bold").setFontSize(7.5);
  doc.setTextColor(...colors.blue).text(`${summary.percentNoPrazo}% no prazo (${summary.noPrazo})`, tx, y + 19.5);
  doc.setTextColor(...colors.red).text(`${summary.percentAtrasadas}% atrasadas (${summary.atrasadas})`, tx + tw, y + 19.5, { align: "right" });
}

function drawPdfSummary(doc, data, y, pageW) {
  const { colors, margin } = REPORT_PDF;
  const gap = 4, h = 24;
  const cardW = (pageW - 2 * margin - 4 * gap) / 5; // 3 cards + análise (≈ 2 cards)
  const s = data.summary;
  const cards = [
    { value: s.total, label: "Total pendente", color: colors.blue, soft: colors.blueSoft,
      icon: (cx, cy, c) => pdfIconDocument(doc, cx, cy, c) },
    { value: s.noPrazo, label: "No prazo", color: colors.green, soft: colors.greenSoft,
      icon: (cx, cy, c) => pdfIconCheck(doc, cx, cy, 2.6, c) },
    { value: s.atrasadas, label: "Atrasadas", color: colors.red, soft: colors.redSoft,
      icon: (cx, cy, c) => pdfIconClock(doc, cx, cy, 2.6, c) }
  ];
  cards.forEach((card, i) => drawPdfKpiCard(doc, margin + i * (cardW + gap), y, cardW, h, card));
  drawPdfAnalysis(doc, margin + 3 * (cardW + gap), y, cardW * 2 + gap, h, s);
  return y + h;
}

/* --------------------------------------------------------------------- */
/* Tabela                                                                  */
/* --------------------------------------------------------------------- */

const REPORT_PDF_COLUMNS = [
  { header: "Código", width: 17 },
  { header: "Escola", width: 36 },
  { header: "Coleção / Módulo", width: 22 },
  { header: "Ano / Frente", width: 24 },
  { header: "Categoria / Subcategoria", width: 25 },
  { header: "Prioridade", width: 21 },
  { header: "Responsável", width: 26 },
  { header: "Prazo", width: 17 },
  { header: "Status", width: 23 },
  { header: "Descrição do problema", width: "auto" }
];
const PDF_COL = { codigo: 0, escola: 1, prioridade: 5, status: 8, descricao: 9 };

function buildReportPdfBody(rows) {
  const join = (a, b, sep) => [pdfText(a), pdfText(b)].filter(Boolean).join(sep) || "-";
  return rows.map((row) => [
    pdfText(row.codigo) || "-",
    pdfText(row.escola) || "Não informado",
    join(row.colecao, row.modulo, " / "),
    join(row.ano, row.frente, "\n"),
    join(row.categoria, row.subcategoria, "\n"),
    "", // prioridade: badge desenhado em didDrawCell
    pdfText(row.responsavel) || "-",
    pdfText(row.prazo) || "-",
    "", // status: badge desenhado em didDrawCell
    pdfText(row.descricao) || "-"
  ]);
}

/** Badge arredondado (pílula) centralizado verticalmente na célula. */
function drawPdfPill(doc, cell, { text, textColor, bg, drawIcon }) {
  doc.setFont("helvetica", "bold").setFontSize(6.8);
  const padL = drawIcon ? 5 : 2.5;
  const w = Math.min(cell.width - 3, doc.getTextWidth(text) + padL + 2.5);
  const h = 4.8, x = cell.x + 1.5, y = cell.y + (cell.height - h) / 2;
  doc.setFillColor(...bg).roundedRect(x, y, w, h, 2.4, 2.4, "F");
  if (drawIcon) drawIcon(x + 2.6, y + h / 2);
  doc.setTextColor(...textColor).text(text, x + padL, y + h / 2 + 1.05);
}

function drawReportPdfTable(doc, rows, assets, startY, generatedText) {
  const { colors, margin, priorityColors } = REPORT_PDF;
  const logoSize = 5.6;
  const columnStyles = {};
  REPORT_PDF_COLUMNS.forEach((col, i) => {
    columnStyles[i] = { cellWidth: col.width };
  });
  columnStyles[PDF_COL.escola] = { ...columnStyles[PDF_COL.escola], fontStyle: "bold",
    cellPadding: { top: 2.6, right: 1.8, bottom: 2.6, left: 2 + logoSize + 2 } };
  columnStyles[PDF_COL.descricao] = { ...columnStyles[PDF_COL.descricao], fontSize: 7.2 };

  doc.autoTable({
    startY,
    margin: { left: margin, right: margin, top: 18, bottom: 16 },
    head: [REPORT_PDF_COLUMNS.map((c) => c.header)],
    body: buildReportPdfBody(rows),
    showHead: "everyPage",
    rowPageBreak: "avoid",
    theme: "plain",
    styles: {
      font: "helvetica",
      fontSize: 7.5,
      textColor: colors.text,
      cellPadding: { top: 2.6, right: 2, bottom: 2.6, left: 2 },
      minCellHeight: 9,
      valign: "middle",
      overflow: "linebreak",
      lineColor: colors.line,
      lineWidth: { bottom: 0.2 }
    },
    headStyles: { fillColor: colors.headBg, textColor: colors.headText, fontStyle: "bold", fontSize: 7.5, minCellHeight: 8 },
    columnStyles,
    didDrawPage(hook) {
      // Páginas seguintes: título reduzido em faixa azul fina
      if (hook.pageNumber > 1) {
        const pageW = doc.internal.pageSize.getWidth();
        doc.setFillColor(...colors.blue).rect(0, 0, pageW, 12, "F");
        doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(255, 255, 255);
        doc.text("Relatório de Tarefas Pendentes", margin, 7.8);
        doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...colors.heroMuted);
        doc.text(`continuação • Gerado em ${generatedText}`, pageW - margin, 7.8, { align: "right" });
      }
    },
    didDrawCell(hook) {
      if (hook.section !== "body") return;
      const row = rows[hook.row.index];
      const { cell } = hook;
      const status = getStatusInfo(row.status);

      if (hook.column.index === PDF_COL.codigo && status.late) {
        doc.setFillColor(...colors.red).rect(cell.x, cell.y, 0.9, cell.height, "F");
      }

      if (hook.column.index === PDF_COL.prioridade && isFilled(row.prioridade)) {
        const info = getPriorityInfo(row.prioridade);
        drawPdfPill(doc, cell, {
          text: pdfText(info.label),
          textColor: colors.text,
          bg: colors.pillBg,
          drawIcon: (ix, iy) => doc.setFillColor(...priorityColors[info.key]).circle(ix, iy, 0.95, "F")
        });
      }

      if (hook.column.index === PDF_COL.status) {
        const color = status.late ? colors.red : colors.blue;
        drawPdfPill(doc, cell, {
          text: status.label || "-",
          textColor: color,
          bg: status.late ? colors.redSoft : colors.blueSoft,
          drawIcon: (ix, iy) => (status.late ? pdfIconClock : pdfIconCheck)(doc, ix, iy, 1.25, color)
        });
      }

      if (hook.column.index === PDF_COL.escola) {
        const lx = cell.x + 2, ly = cell.y + (cell.height - logoSize) / 2;
        const img = assets.schoolLogos.get(normalizeText(row.escola_imagem));
        let drawn = false;
        if (img) {
          try {
            const ratio = img.width / img.height;
            const w = ratio >= 1 ? logoSize : logoSize * ratio;
            const h = ratio >= 1 ? logoSize / ratio : logoSize;
            doc.addImage(img.dataUrl, "PNG", lx + (logoSize - w) / 2, ly + (logoSize - h) / 2, w, h);
            drawn = true;
          } catch (err) {
            drawn = false;
          }
        }
        if (!drawn) {
          doc.setFillColor(...colors.blue).circle(lx + logoSize / 2, ly + logoSize / 2, logoSize / 2, "F");
          doc.setFont("helvetica", "bold").setFontSize(5).setTextColor(255, 255, 255);
          doc.text(getInitials(pdfText(row.escola) || "?"), lx + logoSize / 2, ly + logoSize / 2 + 0.7, { align: "center" });
        }
      }
    }
  });
}

/** Rodapé: "Sistema GGE de Ensino • Pendências editoriais • Página X de Y" + data menor. */
function drawReportPdfFooters(doc, generatedShort, pageW, pageH) {
  const { colors, margin } = REPORT_PDF;
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setDrawColor(...colors.line).setLineWidth(0.25).line(margin, pageH - 12, pageW - margin, pageH - 12);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...colors.muted);
    doc.text(`Sistema GGE de Ensino • Pendências editoriais • Página ${i} de ${total}`, margin, pageH - 8);
    doc.setFontSize(6.5).text(`Gerado em ${generatedShort}`, margin, pageH - 4.8);
  }
}

/* --------------------------------------------------------------------- */
/* Montagem do documento                                                   */
/* --------------------------------------------------------------------- */

/**
 * Monta o PDF (A4 paisagem) e devolve o documento jsPDF.
 * `data`: { rows, summary, mainFilters, internalFilters, generatedAt }
 * `assets`: { logo, schoolLogos: Map(url -> {dataUrl,width,height}) }
 */
function createReportPdf(JsPDF, data, assets) {
  const { colors, margin, heroHeight } = REPORT_PDF;
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const { date, time } = formatDateTimeBR(data.generatedAt);

  drawPdfHero(doc, data, assets, pageW);
  const y = drawPdfSummary(doc, data, heroHeight + 6, pageW) + 6;

  if (data.rows.length === 0) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...colors.muted);
    doc.text("Nenhuma tarefa pendente encontrada para os filtros selecionados.", margin, y + 6);
  } else {
    drawReportPdfTable(doc, data.rows, assets, y, `${date} às ${time}`);
  }

  drawReportPdfFooters(doc, `${date} ${time}`, pageW, pageH);
  return doc;
}

/* --------------------------------------------------------------------- */
/* Ponto de entrada (navegador)                                            */
/* --------------------------------------------------------------------- */

function pdfError(userMessage, cause) {
  const err = new Error(userMessage, { cause });
  err.userMessage = userMessage;
  return err;
}

/**
 * Verifica as bibliotecas locais (vendor/). O jsPDF 2.x expõe `window.jspdf.jsPDF`
 * e guarda plugins em `jsPDF.API` (copiados para cada instância), não no prototype.
 * Retorna { JsPDF } ou { error } com a mensagem específica.
 */
function getReportPdfLibrary() {
  const JsPDF = window.jspdf && window.jspdf.jsPDF;
  if (typeof JsPDF !== "function") {
    return { error: "A biblioteca jsPDF (vendor/jspdf-2.5.1) não foi carregada. Recarregue a página." };
  }
  if (!JsPDF.API || typeof JsPDF.API.autoTable !== "function") {
    return { error: "O plugin AutoTable (vendor/jspdf-autotable-3.8.2) não foi carregado. Recarregue a página." };
  }
  return { JsPDF };
}

async function exportReportPdf(data) {
  const { JsPDF, error } = getReportPdfLibrary();
  if (error) throw pdfError(error);

  const assets = await loadReportPdfAssets(data.rows);
  let doc;
  try {
    doc = createReportPdf(JsPDF, data, assets);
  } catch (err) {
    throw pdfError("Ocorreu um erro ao montar o documento PDF. Tente novamente.", err);
  }
  doc.save(buildReportPdfFileName(data.mainFilters, data.generatedAt));
}

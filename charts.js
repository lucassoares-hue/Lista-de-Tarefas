/* ==========================================================================
   Gráficos (Chart.js) - Dashboard de Pendências - Sistema GGE
   ========================================================================== */

let chartOrigem = null;
let chartFrente = null;
let chartColecao = null;
let chartModulo = null; // instância ECharts (pizza/rosca "Erro por Módulo")

/* Breakpoints dos gráficos (iguais aos do CSS) — fonte única para todos os gráficos */
const CHART_BREAKPOINTS = { mobile: "(max-width: 768px)", narrow: "(max-width: 480px)" };

/** "desktop" (> 768px), "mobile" (≤ 768px) ou "narrow" (≤ 480px). */
function getChartLayoutMode() {
  if (typeof window.matchMedia !== "function") return "desktop";
  if (window.matchMedia(CHART_BREAKPOINTS.narrow).matches) return "narrow";
  if (window.matchMedia(CHART_BREAKPOINTS.mobile).matches) return "mobile";
  return "desktop";
}

function isMobileLayout() {
  return getChartLayoutMode() !== "desktop";
}

/** Quebra um rótulo em até `maxLines` linhas de ~`maxChars` (sem cortar palavras quando possível). */
function wrapChartLabel(label, maxChars, maxLines) {
  const words = String(label).split(/\s+/);
  const lines = [];
  let current = "";
  words.forEach((word) => {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1]} ${lines.slice(maxLines).join(" ")}`;
  return kept;
}

/**
 * Plugin Chart.js: desenha a quantidade ao final/topo de cada barra
 * (horizontal ou vertical, de acordo com `indexAxis`). Nas horizontais, se
 * o número não couber após a barra, ele é desenhado dentro dela (em branco),
 * para nunca ficar cortado na borda do gráfico.
 */
const barValueLabelPlugin = {
  id: "barValueLabels",
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const isHorizontal = chart.options.indexAxis === "y";
    chart.data.datasets.forEach((dataset, dsIndex) => {
      const meta = chart.getDatasetMeta(dsIndex);
      if (meta.hidden) return;
      meta.data.forEach((bar, index) => {
        const value = dataset.data[index];
        if (value === undefined || value === null) return;
        ctx.save();
        ctx.fillStyle = "#1f2430";
        ctx.font = "600 11px 'Segoe UI', sans-serif";
        if (isHorizontal) {
          const text = String(value);
          const textW = ctx.measureText(text).width;
          const fitsOutside = bar.x + 6 + textW <= chart.width - 2;
          const barW = bar.x - bar.base;
          ctx.textBaseline = "middle";
          if (fitsOutside || barW < textW + 10) {
            ctx.textAlign = "left";
            ctx.fillText(text, Math.min(bar.x + 6, chart.width - textW - 2), bar.y);
          } else {
            ctx.textAlign = "right";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(text, bar.x - 5, bar.y);
          }
        } else {
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(String(value), bar.x, bar.y - 4);
        }
        ctx.restore();
      });
    });
  }
};

/**
 * Define a cor de uma origem de erro de acordo com regras fixas para
 * categorias conhecidas, e cores institucionais por posição no ranking
 * para as demais.
 */
function getOrigemColor(label, index) {
  const normalized = String(label)
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .trim()
    .toUpperCase();

  if (normalized === "NAO INFORMADO") return COLORS.blueLighter;
  if (normalized === "EDITORIAL") return COLORS.green;
  if (normalized === "N/A") return COLORS.orange;
  if (normalized === "DIAGRAMACAO") return COLORS.red;

  if (index === 0) return COLORS.blue;
  if (index === 1) return COLORS.blueLight;
  return COLORS.palette[index % COLORS.palette.length];
}

/** Cria os gráficos Chart.js vazios. Deve ser chamado uma única vez. */
function initCharts() {
  const elModulo = document.getElementById("chart-modulo");
  if (elModulo && window.echarts) {
    chartModulo = echarts.init(elModulo);
    // Acompanha a largura real do card (layout, splash, rotação), não só da janela
    if (typeof ResizeObserver === "function") {
      new ResizeObserver(() => chartModulo.resize()).observe(elModulo);
    } else {
      window.addEventListener("resize", () => chartModulo.resize());
    }
  }

  // Ao cruzar um breakpoint, redesenha os gráficos com a configuração do novo modo
  if (typeof window.matchMedia === "function") {
    Object.values(CHART_BREAKPOINTS).forEach((query) => {
      window.matchMedia(query).addEventListener("change", () => {
        if (typeof applyFilters === "function") applyFilters();
      });
    });
  }

  // Sem Chart.js (ex.: falha no CDN), os gráficos de barras ficam vazios,
  // mas o restante do painel (cards, rankings e tabela) continua funcionando.
  if (!window.Chart) {
    console.error("Chart.js não foi carregado; gráficos de barras desativados.");
    return;
  }

  const ctxOrigem = document.getElementById("chart-origem").getContext("2d");
  const ctxFrente = document.getElementById("chart-frente").getContext("2d");
  const ctxColecao = document.getElementById("chart-colecao").getContext("2d");

  chartOrigem = new Chart(ctxOrigem, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Quantidade",
          data: [],
          backgroundColor: [],
          borderRadius: 4,
          maxBarThickness: 22
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: () => ({ right: isMobileLayout() ? 10 : 28 })
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${item.formattedValue}`
          }
        },
        title: { display: false }
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 }, grid: { display: false } },
        y: {
          ticks: { autoSkip: false, font: { size: 11 } },
          grid: { display: false }
        }
      }
    },
    plugins: [barValueLabelPlugin]
  });

  chartFrente = new Chart(ctxFrente, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Erros",
          data: [],
          backgroundColor: COLORS.blue,
          borderRadius: 4,
          maxBarThickness: 18
        }
      ]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: () => (isMobileLayout() ? { left: 0, right: 8 } : { left: 8, right: 36 })
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title: (items) => items[0].dataset.fullLabels[items[0].dataIndex]
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grace: "12%"
        },
        y: {
          // Desktop: eixo fixo de 130px. Mobile: proporcional ao card, sem estourar a largura.
          afterFit: (scale) => {
            scale.width = isMobileLayout() ? Math.min(130, Math.round(scale.chart.width * 0.42)) : 130;
          },
          ticks: {
            autoSkip: false,
            font: () => ({ size: isMobileLayout() ? 10.5 : 9 }),
            callback: function (value) {
              const label = this.getLabelForValue(value);
              // Mobile: até 2 linhas, sem cortar (nome completo também no tooltip)
              if (isMobileLayout()) return wrapChartLabel(label, 17, 2);
              return label.length > 24 ? label.slice(0, 24) + "…" : label;
            }
          }
        }
      }
    },
    plugins: [barValueLabelPlugin]
  });

  chartColecao = new Chart(ctxColecao, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Erros",
          data: [],
          backgroundColor: COLORS.blue,
          borderRadius: 4,
          maxBarThickness: 40
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 20 }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => `${item.label}: ${item.formattedValue}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#f0f0f0" } }
      }
    },
    plugins: [barValueLabelPlugin]
  });
}

/**
 * Atualiza os gráficos Chart.js/ECharts e o ranking de escolas a partir do
 * conjunto de linhas filtradas (canônicas). `validRows` = linhas em que o
 * solicitante está preenchido.
 */
function updateCharts(validRows) {
  updateChartOrigem(validRows);
  updateChartModulo(validRows);
  updateChartFrente(validRows);
  renderCategorySubcategoryRanking(validRows);
  updateChartColecao(validRows);
  updateSchoolRanking(validRows);
}

/** Gráfico: Erros por Coleção (agrupado por colecao, barras verticais). */
function updateChartColecao(validRows) {
  const grouped = countByGroup(validRows, (row) =>
    isFilled(row.colecao) ? row.colecao : "Não informado"
  );
  grouped.sort((a, b) => b.value - a.value);

  const totalEl = document.getElementById("colecao-total-erros");
  if (totalEl) totalEl.textContent = validRows.length;

  if (!chartColecao) return;
  chartColecao.data.labels = grouped.map((g) => g.label);
  chartColecao.data.datasets[0].data = grouped.map((g) => g.value);
  chartColecao.update();
}

/** Gráfico 1: Origem dos Erros (agrupado por origem_erro, barras horizontais). */
function updateChartOrigem(validRows) {
  if (!chartOrigem) return;
  const grouped = countByGroup(validRows, (row) =>
    isFilled(row.origem_erro) ? row.origem_erro : "Não informado"
  );
  grouped.sort((a, b) => b.value - a.value);

  // Mobile: altura proporcional ao número de categorias (desktop mantém o CSS)
  const wrapper = chartOrigem.canvas.parentElement;
  wrapper.style.height = isMobileLayout() ? `${Math.max(220, grouped.length * 34 + 50)}px` : "";

  chartOrigem.data.labels = grouped.map((g) => g.label);
  chartOrigem.data.datasets[0].data = grouped.map((g) => g.value);
  chartOrigem.data.datasets[0].backgroundColor = grouped.map((g, i) =>
    getOrigemColor(g.label, i)
  );
  chartOrigem.update();
}

/**
 * Gráfico "Erro por Módulo": pizza/rosca com efeito 3D (Apache ECharts).
 * Agrupa por modulo, contando apenas registros válidos (solicitante
 * preenchido) e calculando o percentual de cada módulo em relação ao
 * total filtrado.
 */
function updateChartModulo(validRows) {
  if (!chartModulo) return;

  const grouped = countByGroup(validRows, (row) =>
    isFilled(row.modulo) ? row.modulo : "Não informado"
  );
  grouped.sort((a, b) => b.value - a.value);

  const total = grouped.reduce((sum, g) => sum + g.value, 0);
  const percentOf = (value) => (total > 0 ? ((value / total) * 100).toFixed(1).replace(".", ",") : "0,0");
  const valueByName = new Map(grouped.map((g) => [g.label, g.value]));
  const layout = getModuloChartLayout(getChartLayoutMode(), grouped.length, percentOf, valueByName);

  // Altura do container por modo (desktop mantém a do CSS) antes de redimensionar
  chartModulo.getDom().style.height = layout.height ? `${layout.height}px` : "";

  const data = grouped.map((g, i) => ({
    name: g.label,
    value: g.value,
    itemStyle: { color: COLORS.palette[i % COLORS.palette.length] }
  }));

  // notMerge: troca completa de configuração ao mudar de modo (desktop/mobile/estreito)
  chartModulo.setOption({
    color: COLORS.palette,
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params) => `${params.name}<br/>${params.value} (${percentOf(params.value)}%)`
    },
    legend: {
      left: "center",
      icon: "circle",
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { fontSize: layout.legendFontSize, color: "#1f2430" },
      ...layout.legend
    },
    series: [
      {
        name: "Erro por Módulo",
        type: "pie",
        radius: layout.radius,
        center: layout.center,
        avoidLabelOverlap: true,
        label: {
          fontWeight: 600,
          color: "#1f2430",
          ...layout.label
        },
        labelLine: {
          smooth: true,
          ...layout.labelLine
        },
        itemStyle: {
          borderColor: "#ffffff",
          borderWidth: 2,
          shadowBlur: 12,
          shadowColor: "rgba(15, 23, 42, 0.25)",
          shadowOffsetX: 2,
          shadowOffsetY: 4
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 18,
            shadowColor: "rgba(15, 23, 42, 0.35)"
          }
        },
        data
      }
    ]
  }, true);

  chartModulo.resize();
}

/**
 * Configuração da rosca "Erro por Módulo" por modo de layout.
 * - desktop: configuração original (rótulos externos "49 (44,1%)", legenda com rolagem).
 * - mobile:  raio menor, rótulos externos em 2 linhas, legenda que quebra linhas.
 * - narrow:  rosca no topo (centro em px), % dentro das fatias maiores e legenda
 *            completa abaixo com nome, quantidade e % de todos os módulos.
 */
function getModuloChartLayout(mode, itemCount, percentOf, valueByName) {
  if (mode === "narrow") {
    const pieArea = 220;
    const legendRows = Math.ceil(itemCount / 2);
    return {
      height: pieArea + 16 + legendRows * 24,
      // Raios em px, proporcionais à área da rosca (raio externo = 45% da altura)
      radius: [`${Math.round(pieArea * 0.25)}px`, `${Math.round(pieArea * 0.45)}px`],
      center: ["50%", `${pieArea / 2}px`],
      legendFontSize: 12,
      legend: {
        type: "plain",
        top: pieArea + 8,
        width: "96%",
        itemGap: 12,
        formatter: (name) => `${name}  ${valueByName.get(name)} (${percentOf(valueByName.get(name))}%)`
      },
      label: {
        position: "inside",
        fontSize: 11,
        color: "#ffffff",
        formatter: (params) => (params.percent >= 8 ? `${Math.round(params.percent)}%` : "")
      },
      labelLine: { show: false }
    };
  }
  if (mode === "mobile") {
    return {
      height: 340 + Math.max(0, Math.ceil(itemCount / 4) - 1) * 22,
      radius: ["30%", "50%"],
      center: ["50%", "42%"],
      legendFontSize: 12,
      legend: { type: "plain", bottom: 0, width: "94%" },
      label: {
        show: true,
        fontSize: 11,
        formatter: (params) => `${params.value}\n${percentOf(params.value)}%`
      },
      labelLine: { length: 8, length2: 6 }
    };
  }
  return {
    height: null,
    radius: ["38%", "65%"],
    center: ["50%", "42%"],
    legendFontSize: 11,
    legend: { type: "scroll", bottom: 0 },
    label: {
      show: true,
      fontSize: 11,
      formatter: (params) => `${params.value} (${percentOf(params.value)}%)`
    },
    labelLine: { length: 12, length2: 10 }
  };
}

/** Gráfico 3: Quantidade de Erros por Frente (agrupado por ano + frente, barras horizontais). */
function updateChartFrente(validRows) {
  if (!chartFrente) return;
  const grouped = countByGroup(validRows, (row) => {
    const ano = isFilled(row.ano) ? row.ano : "S/ ano";
    const frente = isFilled(row.frente) ? row.frente : "S/ frente";
    return `${ano} - ${frente}`;
  });
  grouped.sort((a, b) => b.value - a.value);

  // Altura dinâmica do contêiner do canvas, proporcional à quantidade de
  // barras, permitindo rolagem vertical dentro do card (altura fixa).
  const inner = document.getElementById("chart-frente-inner");
  // No mobile os nomes podem ocupar 2 linhas: mais altura por barra
  const height = Math.max(320, grouped.length * (isMobileLayout() ? 36 : 24));
  inner.style.height = `${height}px`;

  chartFrente.data.labels = grouped.map((g) => g.label);
  chartFrente.data.datasets[0].data = grouped.map((g) => g.value);
  chartFrente.data.datasets[0].fullLabels = grouped.map((g) => g.label);
  chartFrente.resize();
  chartFrente.update();
}

/**
 * Bloco "Erros por Categoria e Subcategoria": ranking hierárquico em HTML/CSS
 * (sem bibliotecas de gráfico). Agrupa por categoria e, dentro de cada
 * categoria, por subcategoria, contando apenas registros válidos
 * (solicitante preenchido) e calculando o percentual de cada subcategoria
 * em relação ao total filtrado.
 */
function renderCategorySubcategoryRanking(validRows) {
  const container = document.getElementById("category-ranking");
  if (!container) return;

  const groups = new Map(); // categoria -> Map(subcategoria -> count)
  let total = 0;
  let maxSubValue = 0;

  validRows.forEach((row) => {
    const categoria = isFilled(row.categoria) ? normalizeText(row.categoria) : "Não informado";
    const subcategoria = isFilled(row.subcategoria) ? normalizeText(row.subcategoria) : "Não informado";

    if (!groups.has(categoria)) groups.set(categoria, new Map());
    const subMap = groups.get(categoria);
    subMap.set(subcategoria, (subMap.get(subcategoria) || 0) + 1);
    total += 1;
  });

  const categories = Array.from(groups.entries())
    .map(([categoria, subMap]) => {
      const subcategories = Array.from(subMap.entries())
        .map(([subcategoria, count]) => {
          if (count > maxSubValue) maxSubValue = count;
          return {
            nome: subcategoria,
            total: count,
            percent: total > 0 ? (count / total) * 100 : 0
          };
        })
        .sort((a, b) => b.total - a.total);

      const categoriaTotal = subcategories.reduce((sum, s) => sum + s.total, 0);

      return { nome: categoria, total: categoriaTotal, subcategories };
    })
    .sort((a, b) => b.total - a.total);

  container.innerHTML = "";

  if (categories.length === 0) {
    container.innerHTML = `<div class="school-ranking-empty">Nenhum dado encontrado para os filtros selecionados.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();

  categories.forEach((categoria, categoriaIndex) => {
    const color = COLORS.palette[categoriaIndex % COLORS.palette.length];

    const group = document.createElement("div");
    group.className = "category-group";

    const header = document.createElement("div");
    header.className = "category-group-header";
    header.style.borderLeftColor = color;
    header.innerHTML = `
      <span class="category-name" title="${escapeHtml(categoria.nome)}">${escapeHtml(categoria.nome)}</span>
      <span class="category-total">${categoria.total} erro${categoria.total === 1 ? "" : "s"}</span>
    `;
    group.appendChild(header);

    const subList = document.createElement("div");
    subList.className = "category-sub-list";

    categoria.subcategories.forEach((sub) => {
      const widthPercent = maxSubValue > 0 ? Math.max((sub.total / maxSubValue) * 100, 4) : 0;
      const percentLabel = sub.percent.toFixed(1).replace(".", ",");

      const row = document.createElement("div");
      row.className = "category-sub-row";
      row.innerHTML = `
        <span class="sub-name" title="${escapeHtml(sub.nome)}">${escapeHtml(sub.nome)}</span>
        <div class="sub-bar-area">
          <div class="sub-bar" style="width: ${widthPercent}%; background-color: ${color}"></div>
        </div>
        <span class="sub-value">${sub.total} — ${percentLabel}%</span>
      `;
      subList.appendChild(row);
    });

    group.appendChild(subList);
    fragment.appendChild(group);
  });

  container.appendChild(fragment);
}

/**
 * Bloco 4: Escolas por Volume de Solicitações.
 * Ranking em HTML/CSS (sem Chart.js), agrupado por escola, contando apenas
 * solicitações válidas (solicitante preenchido), ordenado do maior para o
 * menor volume, com a logo/imagem da escola (campo escola_imagem).
 */
function updateSchoolRanking(validRows) {
  const container = document.getElementById("school-ranking");
  if (!container) return;

  // Agrupa contagem e mantém a primeira imagem encontrada para cada escola.
  const counts = new Map();
  const images = new Map();

  validRows.forEach((row) => {
    const escola = isFilled(row.escola) ? normalizeText(row.escola) : "Não informado";
    counts.set(escola, (counts.get(escola) || 0) + 1);
    if (!images.has(escola) && isFilled(row.escola_imagem)) {
      images.set(escola, normalizeText(row.escola_imagem));
    }
  });

  const ranking = Array.from(counts.entries())
    .map(([escola, total]) => ({ escola, total, imagem: images.get(escola) || "" }))
    .sort((a, b) => b.total - a.total);

  container.innerHTML = "";

  if (ranking.length === 0) {
    container.innerHTML = `<div class="school-ranking-empty">Nenhum dado encontrado para os filtros selecionados.</div>`;
    return;
  }

  const maxTotal = ranking[0].total;
  const fragment = document.createDocumentFragment();

  ranking.forEach(({ escola, total, imagem }) => {
    const row = document.createElement("div");
    row.className = "school-row";

    const widthPercent = maxTotal > 0 ? Math.max((total / maxTotal) * 100, 8) : 0;
    const initials = getInitials(escola);

    row.innerHTML = `
      <div class="school-info">
        ${
          imagem
            ? `<img class="school-logo" src="${escapeHtml(imagem)}" alt="Logo de ${escapeHtml(escola)}" onerror="this.replaceWith(createSchoolPlaceholder('${escapeHtml(initials)}'))">`
            : `<div class="school-logo school-logo-placeholder">${escapeHtml(initials)}</div>`
        }
        <span class="school-name" title="${escapeHtml(escola)}">${escapeHtml(escola)}</span>
      </div>
      <div class="school-bar-area">
        <div class="school-bar" style="width: ${widthPercent}%">
          <span class="school-value">${total}</span>
        </div>
      </div>
    `;

    fragment.appendChild(row);
  });

  container.appendChild(fragment);
}

/** Gera as iniciais (até 2 letras) a partir do nome da escola. */
function getInitials(name) {
  const words = normalizeText(name).split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** Cria o elemento placeholder usado quando uma imagem de escola falha ao carregar. */
function createSchoolPlaceholder(initials) {
  const div = document.createElement("div");
  div.className = "school-logo school-logo-placeholder";
  div.textContent = initials;
  return div;
}

/** Cria o placeholder (versão compacta) usado na tabela de pendências. */
function createTableSchoolPlaceholder(initials) {
  const div = document.createElement("div");
  div.className = "table-school-logo table-school-logo-placeholder";
  div.textContent = initials;
  return div;
}

/* ==========================================================================
   Configurações gerais do Dashboard de Pendências - Sistema GGE
   ========================================================================== */

// URL do endpoint JSON publicado via Google Apps Script
const API_URL = "https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnSKByLWfwRQNRjFGrJVaWryETyLlkbadKD1HhCY341ZO5K_dNuLi1wmuy07otZMxIhZRI7LyVEeCht7rmYfKPXxcZoPva3KcYfglgTj8gH4iXtEH_5TYOagMSaqjcX29WXkP54hALK0r_XUNivk4UOAUlYz3iH0JD-SrswPnBFCiv93f4laZR9iXFuWtI43Q3jl5_Gk3WAzIDs07ofC7S2pNBbpyzyCnqx0bgbCTJGutHEXJad5HhFTw4SVGNaz4invKpdjP3RoVoECHm35GB2On7WFLFbVWnedK88qK72mpwdXTh3ZS8o2OpuoSQ&lib=MbbcRJ97s6VM4GMYqj46qug5P-Idvl_o1";

// Status considerados "pendentes" (comparação normalizada: maiúsculas, sem espaços extras)
const PENDING_STATUSES = ["NO PRAZO", "ATRASADO"];

// Status considerado "resolvido"
const RESOLVED_STATUS = "RESOLVIDO";

// Paleta de cores no estilo Power BI
const COLORS = {
  blue: "#2F5FA3",
  blueLight: "#5B8DD9",
  blueLighter: "#9DC0F0",
  blueLightest: "#CFE0F7",
  red: "#D64550",
  redLight: "#F2A0A6",
  gray: "#A6A6A6",
  green: "#3FA66E",
  orange: "#E8A33D",
  palette: [
    "#2F5FA3",
    "#5B8DD9",
    "#9DC0F0",
    "#3FA66E",
    "#E8A33D",
    "#D64550",
    "#7C6FB0",
    "#4FB3BF",
    "#C9A227",
    "#8E8E8E"
  ]
};

// Campos canônicos esperados nos dados, com possíveis variações de nomes
// vindas da planilha (sem acentos/espaços/maiúsculas para comparação)
const FIELD_ALIASES = {
  codigo: ["codigo", "cod", "id", "codigodatarefa", "codigotarefa"],
  escola: ["escola", "unidadeescolar", "nomedaescola"],
  escola_imagem: ["escolaimagem", "imagemescola", "logoescola", "logo"],
  colecao: ["colecao", "colecaolivro"],
  modulo: ["modulo"],
  ano: ["ano", "anocolecao", "anoletivo"],
  frente: ["frente"],
  categoria: ["categoria"],
  subcategoria: ["subcategoria", "subcategoriaerro", "subcategoriadoerro", "subcategoriaproblema"],
  prioridade: ["prioridade"],
  responsavel: ["responsavel", "responsaveltarefa"],
  prazo: ["prazo", "dataprazo", "prazofinal"],
  status: ["status", "situacao"],
  descricao: [
    "descricaodoproblema",
    "descricaoproblema",
    "descricao",
    "detalhamento",
    "problema"
  ],
  solicitante: ["solicitante", "requisitante", "nomedosolicitante"],
  data_inicio: ["datainicio", "datadeinicio", "inicio", "dataabertura"],
  data_termino: [
    "datatermino",
    "datadetermino",
    "dataconclusao",
    "datafinal",
    "termino",
    "dataresolucao"
  ],
  origem_erro: ["origemerro", "origemdoerro", "origem", "origemdosolicitante"],
  pagina: ["pagina", "paginas", "numeropagina", "numerodapagina"],
  link_imagem: ["linkimagem", "imagemevidencia", "linkevidencia", "evidencia", "link"],
  tempo_resolucao: [
    "temporesolucao",
    "tempoderesolucao",
    "tempoderesolucaoemdias",
    "temporesolucaodias"
  ]
};

// Mapeamento dos filtros (id do <select>) -> campo canônico dos dados
const FILTER_FIELDS = [
  { id: "filter-colecao", field: "colecao", label: "Coleção" },
  { id: "filter-modulo", field: "modulo", label: "Módulo" },
  { id: "filter-frente", field: "frente", label: "Frente" },
  { id: "filter-ano", field: "ano", label: "Ano" },
  { id: "filter-escola", field: "escola", label: "Escola" },
  { id: "filter-status", field: "status", label: "Status" }
];

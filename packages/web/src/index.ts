const modal = document.getElementById("modal") as HTMLDialogElement;
const modalClose = document.getElementById("close")!;
const help = document.getElementById("help")!;
const search = document.getElementById("search")! as HTMLInputElement;
const compareBar = document.getElementById("compare-bar") as HTMLElement;
const compareCount = document.getElementById("compare-count") as HTMLElement;
const compareBtn = document.getElementById("compare-btn") as HTMLButtonElement;
const compareClear = document.getElementById("compare-clear") as HTMLButtonElement;
const compareModal = document.getElementById("compare-modal") as HTMLDialogElement;
const compareClose = document.getElementById("compare-close") as HTMLButtonElement;
const compareTableContainer = document.getElementById("compare-table-container") as HTMLElement;

/////////////////////////
// URL State Management
/////////////////////////
function getQueryParams() {
  return new URLSearchParams(window.location.search);
}

function updateQueryParams(updates: Record<string, string | null>) {
  const params = getQueryParams();
  for (const [key, value] of Object.entries(updates)) {
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
  }
  const newPath = params.toString()
    ? `${window.location.pathname}?${params.toString()}`
    : window.location.pathname;
  window.history.pushState({}, "", newPath);
}

function getColumnNameForURL(headerEl: Element): string {
  const text = headerEl.textContent?.trim().toLowerCase() || "";
  return text.replace(/↑|↓/g, "").trim().split(/\s+/).slice(0, 2).join("-");
}

function getColumnIndexByUrlName(name: string): number {
  const headers = document.querySelectorAll("th.sortable");
  return Array.from(headers).findIndex(
    (header) => getColumnNameForURL(header) === name
  );
}

/////////////////////////
// Handle "How to use"
/////////////////////////
let y = 0;

help.addEventListener("click", () => {
  y = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${y}px`;
  modal.showModal();
});

function closeDialog() {
  modal.close();
  document.body.style.position = "";
  document.body.style.top = "";
  window.scrollTo(0, y);
}

modalClose.addEventListener("click", closeDialog);
modal.addEventListener("cancel", closeDialog);
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeDialog();
});

////////////////////
// Handle Sorting
////////////////////
let currentSort = { column: -1, direction: "asc" };

function sortTable(column: number, direction: "asc" | "desc") {
  const header = document.querySelectorAll("th.sortable")[column];
  const columnType = header.getAttribute("data-type");
  if (!columnType) return;

  // update state
  currentSort = { column, direction };
  updateQueryParams({
    sort: getColumnNameForURL(header),
    order: direction,
  });

  // sort rows
  const tbody = document.querySelector("table tbody")!;
  const rows = Array.from(
    tbody.querySelectorAll("tr")
  ) as HTMLTableRowElement[];
  rows.sort((a, b) => {
    const aValue = getCellValue(a.cells[column], columnType);
    const bValue = getCellValue(b.cells[column], columnType);

    // Handle undefined values - always sort to bottom
    if (aValue === undefined && bValue === undefined) return 0;
    if (aValue === undefined) return 1;
    if (bValue === undefined) return -1;

    let comparison = 0;
    if (columnType === "number" || columnType === "modalities") {
      comparison = (aValue as number) - (bValue as number);
    } else if (columnType === "boolean") {
      comparison = (aValue as string).localeCompare(bValue as string);
    } else {
      comparison = (aValue as string).localeCompare(bValue as string);
    }

    return direction === "asc" ? comparison : -comparison;
  });
  rows.forEach((row) => tbody.appendChild(row));

  // update sort indicators
  const headers = document.querySelectorAll("th.sortable");
  headers.forEach((header, i) => {
    const indicator = header.querySelector(".sort-indicator")!;

    if (i === column) {
      indicator.textContent = direction === "asc" ? "↑" : "↓";
    } else {
      indicator.textContent = "";
    }
  });
}

function getCellValue(
  cell: HTMLTableCellElement,
  type: string
): string | number | undefined {
  if (type === "modalities")
    return cell.querySelectorAll(".modality-icon").length;

  const text = cell.textContent?.trim() || "";
  if (text === "-") return;
  if (type === "number") return parseFloat(text.replace(/[$,]/g, "")) || 0;
  return text;
}

document.querySelectorAll("th.sortable").forEach((header) => {
  header.addEventListener("click", () => {
    const column = Array.from(header.parentElement!.children).indexOf(header);
    const direction =
      currentSort.column === column && currentSort.direction === "asc"
        ? "desc"
        : "asc";
    sortTable(column, direction);
  });
});

///////////////////
// Handle Search
///////////////////
function filterTable(value: string) {
  const lowerCaseValues = value.toLowerCase().split(",").filter(str => str.trim() !== "");
  const rows = document.querySelectorAll(
    "table tbody tr"
  ) as NodeListOf<HTMLTableRowElement>;

  rows.forEach((row) => {
    const cellTexts = Array.from(row.cells).map((cell) =>
      cell.textContent!.toLowerCase()
    );
    const isVisible = lowerCaseValues.length === 0 ||
     lowerCaseValues.some((lowerCaseValue) => cellTexts.some((text) => text.includes(lowerCaseValue)));
    row.style.display = isVisible ? "" : "none";
  });

  updateQueryParams({ search: value || null });
}

search.addEventListener("input", () => {
  filterTable(search.value);
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    search.focus();
  }
});

search.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    search.value = "";
    search.dispatchEvent(new Event("input"));
  }
});

///////////////////////////////////
// Handle Copy model ID function
///////////////////////////////////
(window as any).copyModelId = async (
  button: HTMLButtonElement,
  modelId: string
) => {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(modelId);

      // Switch to check icon
      const copyIcon = button.querySelector(".copy-icon") as HTMLElement;
      const checkIcon = button.querySelector(".check-icon") as HTMLElement;

      copyIcon.style.display = "none";
      checkIcon.style.display = "block";

      // Switch back after 1 second
      setTimeout(() => {
        copyIcon.style.display = "block";
        checkIcon.style.display = "none";
      }, 1000);
    }
  } catch (err) {
    console.error("Failed to copy text: ", err);
  }
};

///////////////////////////////////////////
// Model Comparison Feature
///////////////////////////////////////////

const MAX_COMPARE = 5;
const selectedModels = new Set<string>();

// Parse embedded model data
const modelsDataEl = document.getElementById("models-data");
const allModelsData: Record<string, Record<string, unknown>> = modelsDataEl
  ? JSON.parse(modelsDataEl.textContent ?? "{}")
  : {};

function updateCompareBar() {
  const count = selectedModels.size;
  compareBar.hidden = count === 0;
  compareCount.textContent = `${count} model${count !== 1 ? "s" : ""} selected`;
  compareBtn.disabled = count < 2;
}

(window as any).toggleCompare = (checkbox: HTMLInputElement, modelKey: string) => {
  if (checkbox.checked) {
    if (selectedModels.size >= MAX_COMPARE) {
      checkbox.checked = false;
      return;
    }
    selectedModels.add(modelKey);
  } else {
    selectedModels.delete(modelKey);
  }
  updateCompareBar();
  syncCompareUrlParam();
};

function syncCompareUrlParam() {
  updateQueryParams({
    compare: selectedModels.size > 0 ? Array.from(selectedModels).join(",") : null,
  });
}

compareClear.addEventListener("click", () => {
  selectedModels.clear();
  document.querySelectorAll<HTMLInputElement>(".compare-checkbox").forEach(cb => {
    cb.checked = false;
  });
  updateCompareBar();
  syncCompareUrlParam();
});

compareBtn.addEventListener("click", () => {
  openCompareDialog();
});

compareClose.addEventListener("click", () => compareModal.close());
compareModal.addEventListener("click", (e) => {
  if (e.target === compareModal) compareModal.close();
});
compareModal.addEventListener("cancel", () => compareModal.close());

function fmt(value: unknown, isCost = false): string {
  if (value === undefined || value === null) return "-";
  if (isCost) return `$${(value as number).toFixed(2)}`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ") || "-";
  if (typeof value === "number") return value.toLocaleString();
  return String(value) || "-";
}

const COMPARE_FIELDS: Array<{ label: string; key: string; isCost?: boolean; betterLow?: boolean; betterHigh?: boolean }> = [
  { label: "Provider", key: "provider" },
  { label: "Model ID", key: "modelId" },
  { label: "Family", key: "family" },
  { label: "Input Cost ($/1M)", key: "input_cost", isCost: true, betterLow: true },
  { label: "Output Cost ($/1M)", key: "output_cost", isCost: true, betterLow: true },
  { label: "Reasoning Cost ($/1M)", key: "reasoning_cost", isCost: true, betterLow: true },
  { label: "Cache Read ($/1M)", key: "cache_read", isCost: true, betterLow: true },
  { label: "Context Window", key: "context", betterHigh: true },
  { label: "Max Output", key: "output", betterHigh: true },
  { label: "Reasoning", key: "reasoning" },
  { label: "Tool Call", key: "tool_call" },
  { label: "Structured Output", key: "structured_output" },
  { label: "Open Weights", key: "open_weights" },
  { label: "Temperature", key: "temperature" },
  { label: "Input Modalities", key: "input_modalities" },
  { label: "Output Modalities", key: "output_modalities" },
  { label: "Knowledge Cutoff", key: "knowledge" },
  { label: "Release Date", key: "release_date" },
];

function getBestValue(models: Record<string, unknown>[], key: string, betterLow?: boolean, betterHigh?: boolean): unknown {
  const vals = models.map(m => m[key]).filter(v => v !== undefined && v !== null);
  if (vals.length === 0) return undefined;
  if (betterLow) return Math.min(...vals.map(v => v as number));
  if (betterHigh) return Math.max(...vals.map(v => v as number));
  return undefined;
}

function openCompareDialog() {
  const models = Array.from(selectedModels).map(key => allModelsData[key] ?? { modelId: key });

  const rows = COMPARE_FIELDS.map(field => {
    const best = getBestValue(models, field.key, field.betterLow, field.betterHigh);
    const cells = models.map(m => {
      const val = m[field.key];
      const text = fmt(val, field.isCost);
      const isBest = best !== undefined && val === best && models.length > 1;
      return `<td class="${isBest ? "compare-best" : ""}">${text}</td>`;
    }).join("");
    return `<tr><th>${field.label}</th>${cells}</tr>`;
  }).join("");

  const headers = models.map(m => `<th>${String(m["name"] ?? m["modelId"] ?? "")}<br><span class="compare-provider-name">${String(m["provider"] ?? "")}</span></th>`).join("");

  compareTableContainer.innerHTML = `
    <div class="compare-scroll">
      <table class="compare-table">
        <thead><tr><th></th>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  let scrollY = 0;
  scrollY = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollY}px`;
  compareModal.showModal();

  compareModal.addEventListener("close", () => {
    document.body.style.position = "";
    document.body.style.top = "";
    window.scrollTo(0, scrollY);
  }, { once: true });
}

///////////////////////////////////
// Initialize State from URL
///////////////////////////////////
function initializeFromURL() {
  const params = getQueryParams();

  (() => {
    const searchQuery = params.get("search");
    if (!searchQuery) return;
    search.value = searchQuery;
    filterTable(searchQuery);
  })();

  (() => {
    const columnName = params.get("sort");
    if (!columnName) return;

    const columnIndex = getColumnIndexByUrlName(columnName);
    if (columnIndex === -1) return;

    const direction = (params.get("order") as "asc" | "desc") || "asc";
    sortTable(columnIndex, direction);
  })();
}

// Restore compare selections from URL
function restoreCompare(params: URLSearchParams) {
  const compareParam = params.get("compare");
  if (!compareParam) return;
  const keys = compareParam.split(",").slice(0, MAX_COMPARE);
  for (const key of keys) {
    selectedModels.add(key);
    const checkbox = document.querySelector<HTMLInputElement>(
      `tr[data-compare-id="${CSS.escape(key)}"] .compare-checkbox`
    );
    if (checkbox) checkbox.checked = true;
  }
  updateCompareBar();
}

document.addEventListener("DOMContentLoaded", () => {
  initializeFromURL();
  restoreCompare(getQueryParams());
});
window.addEventListener("popstate", () => {
  initializeFromURL();
  restoreCompare(getQueryParams());
});

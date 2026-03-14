const modal = document.getElementById("modal") as HTMLDialogElement;
const modalClose = document.getElementById("close")!;
const help = document.getElementById("help")!;
const search = document.getElementById("search")! as HTMLInputElement;
const filtersToggle = document.getElementById("filters-toggle") as HTMLButtonElement;
const filtersPanel = document.getElementById("filters-panel") as HTMLElement;
const filtersClear = document.getElementById("filters-clear") as HTMLButtonElement;
const filterCountBadge = document.getElementById("filter-count") as HTMLElement;
const rowCountEl = document.getElementById("row-count") as HTMLElement;
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
// Faceted Filtering
///////////////////////////////////////////

/** Current active filter values */
const activeFilters: Record<string, string> = {
  reasoning: "",
  tool_call: "",
  structured_output: "",
  open_weights: "",
  min_context: "",
  max_input_cost: "",
  status: "active", // default: hide deprecated
};

/** Count of non-default active filters (shown in badge) */
function countActiveFilters(): number {
  let count = 0;
  if (activeFilters.reasoning !== "") count++;
  if (activeFilters.tool_call !== "") count++;
  if (activeFilters.structured_output !== "") count++;
  if (activeFilters.open_weights !== "") count++;
  if (activeFilters.min_context !== "") count++;
  if (activeFilters.max_input_cost !== "") count++;
  if (activeFilters.status !== "active") count++; // non-default
  return count;
}

function updateFilterBadge() {
  const count = countActiveFilters();
  filterCountBadge.hidden = count === 0;
  filterCountBadge.textContent = String(count);
  filtersToggle.setAttribute("aria-expanded", filtersPanel.hidden ? "false" : "true");
}

function applyFilters() {
  const rows = document.querySelectorAll<HTMLTableRowElement>("table tbody tr");
  const searchVal = search.value.toLowerCase();
  const searchTerms = searchVal.split(",").map(s => s.trim()).filter(Boolean);
  let visible = 0;
  let total = 0;

  rows.forEach((row) => {
    total++;
    let show = true;

    // Search filter (existing)
    if (searchTerms.length > 0) {
      const cellTexts = Array.from(row.cells).map(c => c.textContent!.toLowerCase());
      show = searchTerms.some(term => cellTexts.some(text => text.includes(term)));
    }

    // Boolean capability filters
    for (const filterKey of ["reasoning", "tool_call", "structured_output", "open_weights"] as const) {
      const filterVal = activeFilters[filterKey];
      if (!filterVal) continue;
      const dataAttr = filterKey === "tool_call" ? "data-tool-call" : `data-${filterKey.replace(/_/g, "-")}`;
      const rowVal = row.getAttribute(dataAttr) ?? "";
      if (rowVal === "") {
        // Field not set on this model — hide if filtering for a specific value
        show = false;
      } else if (rowVal !== filterVal) {
        show = false;
      }
    }

    // Min context filter
    if (activeFilters.min_context) {
      const minCtx = parseInt(activeFilters.min_context, 10);
      const rowCtx = parseInt(row.getAttribute("data-context") ?? "0", 10);
      if (rowCtx < minCtx) show = false;
    }

    // Max input cost filter
    if (activeFilters.max_input_cost) {
      const maxCost = parseFloat(activeFilters.max_input_cost);
      const costAttr = row.getAttribute("data-input-cost");
      if (!costAttr) {
        show = false; // no pricing data
      } else if (parseFloat(costAttr) > maxCost) {
        show = false;
      }
    }

    // Status filter
    if (activeFilters.status === "active") {
      const rowStatus = row.getAttribute("data-status") ?? "active";
      if (rowStatus === "deprecated") show = false;
    } else if (activeFilters.status === "deprecated") {
      const rowStatus = row.getAttribute("data-status") ?? "active";
      if (rowStatus !== "deprecated") show = false;
    }
    // "" means show all

    row.style.display = show ? "" : "none";
    if (show) visible++;
  });

  // Update row count display
  if (rowCountEl) {
    rowCountEl.textContent =
      visible === total
        ? `${total.toLocaleString()} models`
        : `${visible.toLocaleString()} of ${total.toLocaleString()} models`;
  }

  updateFilterBadge();
  updateQueryParams({
    reasoning: activeFilters.reasoning || null,
    tool_call: activeFilters.tool_call || null,
    structured_output: activeFilters.structured_output || null,
    open_weights: activeFilters.open_weights || null,
    min_context: activeFilters.min_context || null,
    max_input_cost: activeFilters.max_input_cost || null,
    status: activeFilters.status !== "active" ? activeFilters.status : null,
  });
}

// Tri-state buttons (boolean filters + status)
document.querySelectorAll<HTMLButtonElement>(".tristate-btn, .preset-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const filterKey = btn.getAttribute("data-filter")!;
    const value = btn.getAttribute("data-value") ?? "";

    // Update active state on sibling buttons
    const siblings = btn.parentElement!.querySelectorAll<HTMLButtonElement>(".tristate-btn, .preset-btn");
    siblings.forEach(s => s.classList.remove("active"));
    btn.classList.add("active");

    activeFilters[filterKey] = value;
    applyFilters();
  });
});

// Number input filters
const maxInputCostInput = document.getElementById("filter-max-input-cost") as HTMLInputElement | null;
if (maxInputCostInput) {
  maxInputCostInput.addEventListener("input", () => {
    activeFilters.max_input_cost = maxInputCostInput.value;
    applyFilters();
  });
}

// Toggle filter panel
filtersToggle.addEventListener("click", () => {
  filtersPanel.hidden = !filtersPanel.hidden;
  filtersToggle.setAttribute("aria-expanded", filtersPanel.hidden ? "false" : "true");
});

// Clear all filters
filtersClear.addEventListener("click", () => {
  activeFilters.reasoning = "";
  activeFilters.tool_call = "";
  activeFilters.structured_output = "";
  activeFilters.open_weights = "";
  activeFilters.min_context = "";
  activeFilters.max_input_cost = "";
  activeFilters.status = "active";

  // Reset all tri-state buttons to first (Any/Active) option
  document.querySelectorAll<HTMLButtonElement>(".tristate-btn, .preset-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  document.querySelectorAll<HTMLElement>(".filter-group").forEach(group => {
    const firstBtn = group.querySelector<HTMLButtonElement>(".tristate-btn, .preset-btn");
    if (firstBtn) firstBtn.classList.add("active");
  });

  // Reset number inputs
  if (maxInputCostInput) maxInputCostInput.value = "";

  applyFilters();
});

///////////////////////////////////////////
// Override filterTable to use applyFilters
///////////////////////////////////////////
function filterTable(value: string) {
  updateQueryParams({ search: value || null });
  applyFilters();
}

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
  })();

  // Restore filter state from URL
  for (const key of ["reasoning", "tool_call", "structured_output", "open_weights", "min_context", "max_input_cost"] as const) {
    const val = params.get(key);
    if (val !== null) {
      activeFilters[key] = val;
      // Update button states
      const btns = document.querySelectorAll<HTMLButtonElement>(`[data-filter="${key}"]`);
      btns.forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-value") === val);
      });
      // Restore number input
      if (key === "max_input_cost" && maxInputCostInput) {
        maxInputCostInput.value = val;
      }
    }
  }

  const statusParam = params.get("status");
  if (statusParam !== null) {
    activeFilters.status = statusParam;
    const btns = document.querySelectorAll<HTMLButtonElement>('[data-filter="status"]');
    btns.forEach(btn => {
      btn.classList.toggle("active", btn.getAttribute("data-value") === statusParam);
    });
  }

  applyFilters();

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

///////////////////////////////////////////
// Cost Calculator
///////////////////////////////////////////

interface PricingEntry {
  key: string;
  name: string;
  provider: string;
  input: number;
  output: number;
  cache_read?: number;
}

const calcBtn = document.getElementById("calc-btn") as HTMLButtonElement | null;
const calcModal = document.getElementById("calc-modal") as HTMLDialogElement | null;
const calcClose = document.getElementById("calc-close") as HTMLButtonElement | null;
const calcResults = document.getElementById("calc-results") as HTMLElement | null;

// Parse embedded pricing data
const pricingDataEl = document.getElementById("pricing-data");
const pricingData: PricingEntry[] = pricingDataEl
  ? JSON.parse(pricingDataEl.textContent ?? "[]")
  : [];

function calcTotalCost(
  entry: PricingEntry,
  inputTokens: number,
  outputTokens: number,
  cacheTokens: number,
  requests: number,
): number {
  const perRequest =
    (inputTokens * entry.input) / 1_000_000 +
    (outputTokens * entry.output) / 1_000_000 +
    (cacheTokens * (entry.cache_read ?? 0)) / 1_000_000;
  return perRequest * requests;
}

function renderCalcResults() {
  if (!calcResults) return;

  const inputTokens = parseFloat((document.getElementById("calc-input-tokens") as HTMLInputElement).value) || 0;
  const outputTokens = parseFloat((document.getElementById("calc-output-tokens") as HTMLInputElement).value) || 0;
  const cacheTokens = parseFloat((document.getElementById("calc-cache-tokens") as HTMLInputElement).value) || 0;
  const requests = parseFloat((document.getElementById("calc-requests") as HTMLInputElement).value) || 1;

  const results = pricingData
    .map(entry => ({
      entry,
      total: calcTotalCost(entry, inputTokens, outputTokens, cacheTokens, requests),
    }))
    .sort((a, b) => a.total - b.total)
    .slice(0, 20);

  if (results.length === 0) {
    calcResults.innerHTML = "<p>No models with pricing data available.</p>";
    return;
  }

  const rows = results
    .map(
      ({ entry, total }, i) =>
        `<tr class="${i === 0 ? "calc-cheapest" : ""}">
          <td>${i + 1}</td>
          <td><span class="calc-provider">${entry.provider}</span> ${entry.name}</td>
          <td class="calc-cost">$${total.toFixed(2)}/mo</td>
          <td class="calc-cost-unit">
            $${((entry.input)).toFixed(2)} in
            / $${((entry.output)).toFixed(2)} out
          </td>
        </tr>`,
    )
    .join("");

  calcResults.innerHTML = `
    <table class="calc-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Model</th>
          <th>Est. Monthly Cost</th>
          <th>Rate (per 1M tokens)</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

if (calcBtn && calcModal) {
  calcBtn.addEventListener("click", () => {
    renderCalcResults();
    let scrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    calcModal.showModal();
    calcModal.addEventListener("close", () => {
      document.body.style.position = "";
      document.body.style.top = "";
      window.scrollTo(0, scrollY);
    }, { once: true });
  });

  // Re-calculate on input change
  calcModal.querySelectorAll<HTMLInputElement>(".calc-number").forEach(input => {
    input.addEventListener("input", renderCalcResults);
  });
}

calcClose?.addEventListener("click", () => calcModal?.close());
calcModal?.addEventListener("click", (e) => {
  if (e.target === calcModal) calcModal.close();
});

// Keyboard shortcut: Cmd+Shift+C
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
    e.preventDefault();
    calcBtn?.click();
  }
});

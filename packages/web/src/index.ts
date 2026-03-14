const modal = document.getElementById("modal") as HTMLDialogElement;
const modalClose = document.getElementById("close")!;
const help = document.getElementById("help")!;
const search = document.getElementById("search")! as HTMLInputElement;

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

document.addEventListener("DOMContentLoaded", initializeFromURL);
window.addEventListener("popstate", initializeFromURL);

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

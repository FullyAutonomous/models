type SortDirection = "asc" | "desc";

interface SearchIndexItem {
  type: "model" | "provider" | "lab";
  title: string;
  id: string;
  href: string;
  logo: string;
  tokens: string[];
  lab?: string;
  modelCount?: number;
  providerCount?: number;
  context?: number;
  releaseDate?: string;
  inputCost?: number;
  outputCost?: number;
  npm?: string;
  api?: string;
  updated?: string;
}

interface SearchResult {
  item: SearchIndexItem;
  score: number;
}

const helpModal = document.getElementById("modal") as HTMLDialogElement | null;
const modalClose = document.getElementById("close");
const help = document.getElementById("help");
const mobileMenu = document.getElementById(
  "mobile-menu",
) as HTMLDialogElement | null;
const mobileMenuTrigger = document.getElementById("mobile-menu-trigger");
const mobileMenuClose = document.getElementById("mobile-menu-close");
const mobileSearchTrigger = document.getElementById("mobile-search-trigger");
const mobileHelpTrigger = document.getElementById("mobile-help-trigger");
const searchModal = document.getElementById(
  "search-modal",
) as HTMLDialogElement | null;
const searchTrigger = document.getElementById("search-trigger");
const searchInput = document.getElementById(
  "search-input",
) as HTMLInputElement | null;
const searchResults = document.getElementById("search-results");
const searchCount = document.getElementById("search-count");
const searchEmpty = document.getElementById("search-empty");
const tables = Array.from(
  document.querySelectorAll<HTMLTableElement>("table[data-enhanced-table]"),
);
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

let scrollYBeforeModal = 0;
let lastFocusedElement: HTMLElement | null = null;
let activeSearchIndex = 0;
let rankedSearchResults: SearchResult[] = [];

const searchItems = parseSearchIndex();
const compactNumberFormatter = new Intl.NumberFormat(undefined, {
  notation: "compact",
  maximumFractionDigits: 1,
});

/////////////////////////
// Help Dialog
/////////////////////////
function openHelpDialog() {
  if (!helpModal) return;
  if (searchModal?.open) closeSearchModal();
  if (mobileMenu?.open) closeMobileMenu(false);

  scrollYBeforeModal = window.scrollY;
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollYBeforeModal}px`;
  helpModal.showModal();
}

help?.addEventListener("click", openHelpDialog);

function closeDialog() {
  if (!helpModal) return;
  helpModal.close();
  document.body.style.position = "";
  document.body.style.top = "";
  window.scrollTo(0, scrollYBeforeModal);
}

modalClose?.addEventListener("click", closeDialog);
helpModal?.addEventListener("cancel", closeDialog);
helpModal?.addEventListener("click", (event) => {
  if (event.target === helpModal) closeDialog();
});

////////////////////
// Search
////////////////////
function parseSearchIndex() {
  const index = document.getElementById("search-index")?.textContent;
  if (!index) return [];

  try {
    const parsed = JSON.parse(index);
    return Array.isArray(parsed) ? (parsed as SearchIndexItem[]) : [];
  } catch {
    return [];
  }
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function searchFields(item: SearchIndexItem) {
  return [item.title, item.id, ...item.tokens].filter(Boolean);
}

function fuzzySequenceScore(haystack: string, needle: string) {
  let score = 0;
  let previousIndex = -1;
  let searchFrom = 0;

  for (const character of needle) {
    const index = haystack.indexOf(character, searchFrom);
    if (index === -1) return 0;

    if (index === 0 || haystack[index - 1] === " ") {
      score += 8;
    } else if (index === previousIndex + 1) {
      score += 6;
    } else {
      score += 2;
    }

    previousIndex = index;
    searchFrom = index + 1;
  }

  return score + Math.max(0, 12 - haystack.length / 8);
}

function scoreTerm(field: string, term: string) {
  const normalized = normalizeSearchText(field);
  if (!normalized) return 0;
  if (normalized === term) return 120;
  if (normalized.startsWith(term)) return 100;
  if (normalized.split(" ").some((word) => word.startsWith(term))) return 82;

  const index = normalized.indexOf(term);
  if (index !== -1) return 64 - Math.min(index, 24);

  return fuzzySequenceScore(normalized, term);
}

function scoreSearchItem(item: SearchIndexItem, query: string) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 1;

  let score = 0;
  for (const term of terms) {
    let best = 0;
    for (const field of searchFields(item)) {
      best = Math.max(best, scoreTerm(field, term));
    }
    if (best <= 0) return 0;
    score += best;
  }

  const normalizedTitle = normalizeSearchText(item.title);
  const normalizedId = normalizeSearchText(item.id);
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedTitle === normalizedQuery || normalizedId === normalizedQuery) {
    score += 120;
  } else if (normalizedTitle.startsWith(normalizedQuery)) {
    score += 44;
  } else if (normalizedId.startsWith(normalizedQuery)) {
    score += 36;
  }

  if (item.type === "model") score += 8;
  return score;
}

function rankSearchItems(query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const results = searchItems
    .map((item) => ({ item, score: scoreSearchItem(item, normalizedQuery) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const dateComparison = compareSearchDates(
        searchSortDate(a.item),
        searchSortDate(b.item),
      );
      if (dateComparison !== 0) return dateComparison;
      return a.item.title.localeCompare(b.item.title, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });

  return normalizedQuery ? results.slice(0, 40) : results.slice(0, 18);
}

function compareSearchDates(a?: string, b?: string) {
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b.localeCompare(a);
}

function searchSortDate(item: SearchIndexItem) {
  return item.releaseDate ?? item.updated;
}

function formatCompactNumber(value?: number) {
  if (value === undefined) return undefined;
  return compactNumberFormatter.format(value);
}

function formatCost(input?: number, output?: number) {
  if (input === undefined && output === undefined) return undefined;
  const inputText = input === undefined ? "-" : `$${input.toFixed(2)}`;
  const outputText = output === undefined ? "-" : `$${output.toFixed(2)}`;
  return `${inputText} / ${outputText}`;
}

function appendHighlightedText(
  element: HTMLElement,
  text: string,
  query: string,
) {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    element.textContent = text;
    return;
  }

  const lowerText = text.toLowerCase();
  const ranges = terms
    .map((term) => {
      const index = lowerText.indexOf(term);
      return index === -1 ? undefined : [index, index + term.length] as const;
    })
    .filter((range): range is readonly [number, number] => range !== undefined)
    .sort((a, b) => a[0] - b[0]);

  if (ranges.length === 0) {
    element.textContent = text;
    return;
  }

  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) {
      element.append(document.createTextNode(text.slice(cursor, start)));
    }
    const mark = document.createElement("mark");
    mark.textContent = text.slice(start, end);
    element.append(mark);
    cursor = end;
  }
  if (cursor < text.length) {
    element.append(document.createTextNode(text.slice(cursor)));
  }
}

function resultMeta(item: SearchIndexItem) {
  if (item.type === "model") {
    return [
      item.lab,
      item.providerCount === undefined
        ? undefined
        : `${item.providerCount} providers`,
      item.context === undefined
        ? undefined
        : `${formatCompactNumber(item.context)} context`,
      formatCost(item.inputCost, item.outputCost),
      item.updated,
    ].filter((value): value is string => Boolean(value));
  }

  if (item.type === "provider") {
    return [
      item.modelCount === undefined ? undefined : `${item.modelCount} models`,
      item.npm,
      item.api,
    ].filter((value): value is string => Boolean(value));
  }

  return [
    item.modelCount === undefined ? undefined : `${item.modelCount} models`,
    item.providerCount === undefined
      ? undefined
      : `${item.providerCount} providers`,
    item.updated,
  ].filter((value): value is string => Boolean(value));
}

function resultSubtitle(item: SearchIndexItem) {
  if (item.type === "model") return item.id;
  if (item.type === "provider") return item.id;
  return item.id;
}

function createSearchResult(result: SearchResult, index: number, query: string) {
  const { item } = result;
  const link = document.createElement("a");
  link.className = `search-result search-result-${item.type}`;
  link.href = item.href;
  link.id = `search-result-${index}`;
  link.setAttribute("role", "option");
  link.setAttribute("aria-selected", index === activeSearchIndex ? "true" : "false");
  link.dataset.searchIndex = String(index);
  if (index === activeSearchIndex) link.classList.add("is-active");

  const icon = document.createElement("span");
  icon.className = "search-result-icon";
  const logo = document.createElement("img");
  logo.src = item.logo;
  logo.alt = "";
  logo.loading = "lazy";
  icon.append(logo);
  link.append(icon);

  const body = document.createElement("span");
  body.className = "search-result-body";

  const top = document.createElement("span");
  top.className = "search-result-top";

  const title = document.createElement("span");
  title.className = "search-result-title";
  appendHighlightedText(title, item.title, query);
  top.append(title);

  const kind = document.createElement("span");
  kind.className = "search-result-kind";
  kind.textContent = item.type;
  top.append(kind);
  body.append(top);

  const subtitle = document.createElement("span");
  subtitle.className = "search-result-subtitle mono";
  appendHighlightedText(subtitle, resultSubtitle(item), query);
  body.append(subtitle);

  const meta = document.createElement("span");
  meta.className = "search-result-meta";
  for (const value of resultMeta(item)) {
    const chip = document.createElement("span");
    chip.textContent = value;
    meta.append(chip);
  }
  body.append(meta);

  link.append(body);
  return link;
}

function updateActiveSearchResult() {
  if (!searchResults || !searchInput) return;

  const resultNodes = Array.from(
    searchResults.querySelectorAll<HTMLElement>(".search-result"),
  );

  for (const [index, result] of resultNodes.entries()) {
    const active = index === activeSearchIndex;
    result.classList.toggle("is-active", active);
    result.setAttribute("aria-selected", active ? "true" : "false");
    if (active) {
      searchInput.setAttribute("aria-activedescendant", result.id);
      result.scrollIntoView({ block: "nearest" });
    }
  }
}

function setActiveSearchIndex(index: number) {
  if (rankedSearchResults.length === 0) return;
  activeSearchIndex =
    (index + rankedSearchResults.length) % rankedSearchResults.length;
  updateActiveSearchResult();
}

function renderSearchResults() {
  if (!searchInput || !searchResults || !searchCount || !searchEmpty) return;

  const query = searchInput.value;
  rankedSearchResults = rankSearchItems(query);
  activeSearchIndex = rankedSearchResults.length > 0 ? 0 : -1;
  searchResults.replaceChildren();

  const fragment = document.createDocumentFragment();
  rankedSearchResults.forEach((result, index) => {
    fragment.append(createSearchResult(result, index, query));
  });
  searchResults.append(fragment);

  const normalizedQuery = normalizeSearchText(query);
  searchCount.textContent = normalizedQuery
    ? `${rankedSearchResults.length} result${rankedSearchResults.length === 1 ? "" : "s"}`
    : "Recently updated models, providers, and labs";
  searchEmpty.hidden = rankedSearchResults.length > 0;

  if (rankedSearchResults.length > 0) {
    searchInput.setAttribute("aria-activedescendant", "search-result-0");
  } else {
    searchInput.removeAttribute("aria-activedescendant");
  }
}

function openSearchModal() {
  if (!searchModal || !searchInput) return;
  if (helpModal?.open) closeDialog();
  if (mobileMenu?.open) closeMobileMenu(false);

  lastFocusedElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  if (!searchModal.open) searchModal.showModal();
  renderSearchResults();
  requestAnimationFrame(() => {
    searchInput.focus();
    searchInput.select();
  });
}

function closeSearchModal() {
  if (!searchModal) return;
  if (searchModal.open) searchModal.close();
  searchInput?.removeAttribute("aria-activedescendant");
  lastFocusedElement?.focus();
}

function closestSearchResult(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".search-result[data-search-index]");
}

searchTrigger?.addEventListener("click", openSearchModal);
mobileSearchTrigger?.addEventListener("click", openSearchModal);

/////////////////////
// Mobile Menu
/////////////////////
function openMobileMenu() {
  if (!mobileMenu || !mobileMenuTrigger) return;
  if (searchModal?.open) closeSearchModal();
  if (helpModal?.open) closeDialog();

  mobileMenu.showModal();
  mobileMenuTrigger.setAttribute("aria-expanded", "true");
  requestAnimationFrame(() => {
    mobileMenu
      .querySelector<HTMLElement>(".mobile-menu-list a, .mobile-menu-list button")
      ?.focus();
  });
}

function closeMobileMenu(restoreFocus = true) {
  if (!mobileMenu || !mobileMenuTrigger) return;
  if (mobileMenu.open) mobileMenu.close();
  mobileMenuTrigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) mobileMenuTrigger.focus();
}

mobileMenuTrigger?.addEventListener("click", openMobileMenu);
mobileMenuClose?.addEventListener("click", () => closeMobileMenu());
mobileHelpTrigger?.addEventListener("click", openHelpDialog);

mobileMenu?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMobileMenu();
});

mobileMenu?.addEventListener("click", (event) => {
  if (event.target === mobileMenu) closeMobileMenu();
});

searchModal?.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeSearchModal();
});

searchModal?.addEventListener("click", (event) => {
  if (event.target === searchModal) closeSearchModal();
});

searchResults?.addEventListener("mousemove", (event) => {
  const result = closestSearchResult(event.target);
  if (!result?.dataset.searchIndex) return;
  setActiveSearchIndex(Number(result.dataset.searchIndex));
});

searchResults?.addEventListener("click", (event) => {
  if (closestSearchResult(event.target)) {
    searchInput?.removeAttribute("aria-activedescendant");
  }
});

searchInput?.addEventListener("input", renderSearchResults);

searchInput?.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeSearchModal();
    return;
  }

  if (event.key === "ArrowDown") {
    event.preventDefault();
    setActiveSearchIndex(activeSearchIndex + 1);
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    setActiveSearchIndex(activeSearchIndex - 1);
    return;
  }

  if (event.key === "Enter") {
    const result = rankedSearchResults[activeSearchIndex];
    if (!result) return;
    event.preventDefault();
    window.location.href = result.item.href;
  }
});

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if ((event.metaKey || event.ctrlKey) && (key === "k" || key === "f")) {
    event.preventDefault();
    openSearchModal();
  }
});

////////////////////
// Sorting
////////////////////
function getCellSortValue(row: HTMLTableRowElement, index: number) {
  const cell = row.cells[index];
  return cell?.getAttribute("data-sort") ?? cell?.textContent?.trim() ?? "";
}

function compareValues(a: string, b: string, type: string | null) {
  if (a === "" && b === "") return 0;
  if (a === "") return 1;
  if (b === "") return -1;

  if (type === "number") {
    return Number(a) - Number(b);
  }

  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function sortTable(
  table: HTMLTableElement,
  column: number,
  direction: SortDirection,
) {
  const tbody = table.tBodies[0];
  const header = table.tHead?.rows[0]?.cells[column];
  if (!tbody || !header) return;

  const type = header.getAttribute("data-type");
  const rows = Array.from(tbody.rows).filter(
    (row) => !row.classList.contains("empty-row"),
  );

  rows.sort((rowA, rowB) => {
    const comparison = compareValues(
      getCellSortValue(rowA, column),
      getCellSortValue(rowB, column),
      type,
    );
    return direction === "asc" ? comparison : -comparison;
  });

  for (const row of rows) {
    tbody.appendChild(row);
  }

  for (const sortable of table.querySelectorAll("th.sortable")) {
    sortable.removeAttribute("aria-sort");
    const indicator = sortable.querySelector(".sort-indicator");
    if (indicator) indicator.textContent = "";
  }

  header.setAttribute(
    "aria-sort",
    direction === "asc" ? "ascending" : "descending",
  );
  const indicator = header.querySelector(".sort-indicator");
  if (indicator) indicator.textContent = direction === "asc" ? "↑" : "↓";
}

for (const table of tables) {
  const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("th"));
  headers.forEach((header, column) => {
    if (!header.classList.contains("sortable")) return;

    header.addEventListener("click", () => {
      const current = header.getAttribute("aria-sort");
      const direction: SortDirection =
        current === "ascending" ? "desc" : "asc";
      sortTable(table, column, direction);
    });
  });
}

////////////////////
// Copy Buttons
////////////////////
const copyTimers = new WeakMap<
  HTMLButtonElement,
  ReturnType<typeof setTimeout>
>();
const pointerCopyTimes = new WeakMap<HTMLButtonElement, number>();

function writeClipboardWithSelection(value: string) {
  let copied = false;
  const onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData("text/plain", value);
    event.preventDefault();
    copied = true;
  };
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  window.focus();
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, value.length);
  document.addEventListener("copy", onCopy);

  try {
    return document.execCommand("copy") || copied;
  } finally {
    document.removeEventListener("copy", onCopy);
    textarea.remove();
  }
}

async function writeClipboard(value: string) {
  if (writeClipboardWithSelection(value)) return true;

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

function selectCopySource(button: HTMLButtonElement) {
  const source = button
    .closest(".code-line, td")
    ?.querySelector<HTMLElement>("code, .copy-source, span");
  const selection = window.getSelection();
  if (!source || !selection) return false;

  const range = document.createRange();
  range.selectNodeContents(source);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

async function copyValue(button: HTMLButtonElement, value: string) {
  const originalLabel =
    button.dataset.copyLabel ??
    button.getAttribute("aria-label") ??
    button.title ??
    "Copy";
  button.dataset.copyLabel = originalLabel;

  const copyIcon = button.querySelector<HTMLElement>(".copy-icon");
  const checkIcon = button.querySelector<HTMLElement>(".check-icon");
  const copied = await writeClipboard(value);
  const selected = copied ? false : selectCopySource(button);

  window.clearTimeout(copyTimers.get(button));
  button.classList.toggle("copied", copied);
  button.classList.toggle("selected", selected);
  button.classList.toggle("copy-failed", !copied && !selected);

  const feedback = copied ? "Copied" : selected ? "Selected" : "Copy failed";
  button.setAttribute("aria-label", feedback);
  button.title = feedback;

  if (copyIcon && checkIcon) {
    copyIcon.style.display = copied ? "none" : "block";
    checkIcon.style.display = copied ? "block" : "none";
  }

  copyTimers.set(
    button,
    setTimeout(() => {
      button.classList.remove("copied", "selected", "copy-failed");
      button.setAttribute("aria-label", originalLabel);
      button.title = originalLabel;
      if (copyIcon && checkIcon) {
        copyIcon.style.display = "block";
        checkIcon.style.display = "none";
      }
    }, 1200),
  );
}

function copyFromEventTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return undefined;
  const button = target.closest<HTMLButtonElement>(
    ".copy-button[data-copy-value]",
  );
  const value = button?.dataset.copyValue;
  if (!button || !value) return undefined;
  return { button, value };
}

document.addEventListener("pointerdown", (event) => {
  const copy = copyFromEventTarget(event.target);
  if (!copy) return;
  pointerCopyTimes.set(copy.button, Date.now());
  void copyValue(copy.button, copy.value);
});

document.addEventListener("click", (event) => {
  const copy = copyFromEventTarget(event.target);
  if (!copy) return;

  const pointerCopyTime = pointerCopyTimes.get(copy.button);
  if (pointerCopyTime && Date.now() - pointerCopyTime < 500) return;

  void copyValue(copy.button, copy.value);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  if (!(event.target instanceof Element)) return;
  const copy = copyFromEventTarget(event.target);
  if (!copy) return;
  event.preventDefault();
  void copyValue(copy.button, copy.value);
});

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
  status: "active",
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
  if (activeFilters.status !== "active") count++;
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
  const searchEl = document.getElementById("search") as HTMLInputElement | null;
  const searchVal = searchEl ? searchEl.value.toLowerCase() : "";
  const searchTerms = searchVal.split(",").map(s => s.trim()).filter(Boolean);
  let visible = 0;
  let total = 0;

  rows.forEach((row) => {
    total++;
    let show = true;

    // Search filter
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
        show = false;
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

  document.querySelectorAll<HTMLButtonElement>(".tristate-btn, .preset-btn").forEach(btn => {
    btn.classList.remove("active");
  });
  document.querySelectorAll<HTMLElement>(".filter-group").forEach(group => {
    const firstBtn = group.querySelector<HTMLButtonElement>(".tristate-btn, .preset-btn");
    if (firstBtn) firstBtn.classList.add("active");
  });

  if (maxInputCostInput) maxInputCostInput.value = "";

  applyFilters();
});

function filterTable(value: string) {
  updateQueryParams({ search: value || null });
  applyFilters();
}

///////////////////////////////////////////
// Model Comparison Feature
///////////////////////////////////////////

const MAX_COMPARE = 5;
const selectedModels = new Set<string>();

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

  calcModal.querySelectorAll<HTMLInputElement>(".calc-number").forEach(input => {
    input.addEventListener("input", renderCalcResults);
  });
}

calcClose?.addEventListener("click", () => calcModal?.close());
calcModal?.addEventListener("click", (e) => {
  if (e.target === calcModal) calcModal.close();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "c") {
    e.preventDefault();
    calcBtn?.click();
  }
});

///////////////////////////////////
// URL Query Params
///////////////////////////////////
function getQueryParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function updateQueryParams(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value === null) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  window.history.replaceState(null, "", url.toString());
}

function getColumnIndexByUrlName(columnName: string): number {
  for (const table of tables) {
    const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("th"));
    for (const [index, header] of headers.entries()) {
      const sort = header.getAttribute("data-sort-column");
      if (sort === columnName) return index;
    }
  }
  return -1;
}

///////////////////////////////////
// Initialize State from URL
///////////////////////////////////
function initializeFromURL() {
  const params = getQueryParams();

  // Restore filter state from URL
  for (const key of ["reasoning", "tool_call", "structured_output", "open_weights", "min_context", "max_input_cost"] as const) {
    const val = params.get(key);
    if (val !== null) {
      activeFilters[key] = val;
      const btns = document.querySelectorAll<HTMLButtonElement>(`[data-filter="${key}"]`);
      btns.forEach(btn => {
        btn.classList.toggle("active", btn.getAttribute("data-value") === val);
      });
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
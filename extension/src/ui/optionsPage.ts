import type { PolicyChange } from "../privacy/commitments";
import { escapeHtml } from "./escape";
import {
  cacheLine,
  checksLine,
  contributionLine,
  watchedLine,
  type Holdings,
} from "../storage/holdings";
import { bindPolicyNotice, policyNoticeMarkup } from "./policyNotice";

export interface Platform {
  id: string;
  label: string;
  paused: boolean;
}

export interface OptionsState {
  analysisEnabled: boolean;
  platforms?: readonly Platform[];
  historyEnabled: boolean;
  reputationLookupEnabled: boolean;
  graphContributionEnabled: boolean;
  holdings: Holdings;
  pendingPolicyChanges?: readonly PolicyChange[];
  importMessage?: string | null;
  now?: number;
}

export interface OptionsCallbacks {
  onToggleAnalysis: (enabled: boolean) => void;
  onTogglePlatform: (site: string, paused: boolean) => void;
  onToggleHistory: (enabled: boolean) => void;
  onToggleReputationLookup: (enabled: boolean) => void;
  onToggleGraphContribution: (enabled: boolean) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onDeleteAll: () => void;
  onImport: (file: File) => void;
  onClearCache: () => void;
  onClearWatchlist: () => void;
  onClearQueue: () => void;
  onAcknowledgePolicy: () => void;
}

// a registry id is what a platform is called in the code, and this is what it is called on a
// page somebody reads, without the registry having to carry a second name per platform
export function platformLabel(site: string): string {
  return site
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// the platforms this build runs on, so a build that reads one platform says nothing about lists
function platformMarkup(state: OptionsState): string {
  const platforms = state.platforms ?? [];
  if (platforms.length < 2) {
    return "";
  }
  const rows = platforms
    .map((platform) => `
        <label class="platform">
          <input
            type="checkbox"
            class="platform-toggle"
            data-site="${escapeHtml(platform.id)}"
            ${platform.paused ? "" : "checked"}
            ${state.analysisEnabled ? "" : "disabled"}
          />
          ${escapeHtml(platform.label)}
        </label>`)
    .join("");
  return `
      <fieldset class="platforms">
        <legend>Where</legend>${rows}
      </fieldset>`;
}

export function renderOptions(
  container: HTMLElement,
  state: OptionsState,
  callbacks: OptionsCallbacks,
): void {
  const now = state.now ?? Date.now();
  container.innerHTML = `
    <header>
      <span class="wordmark">verdict</span>
    </header>
    ${policyNoticeMarkup(state.pendingPolicyChanges ?? [], now)}
    <section class="setting">
      <label>
        <input type="checkbox" class="analysis-toggle" ${state.analysisEnabled ? "checked" : ""} />
        Read the pages I open
      </label>
      <p class="hint">
        Turning this off leaves Verdict installed and silent: no page is read and no panel is
        drawn, anywhere. A listing you open from the check page on the website is still read,
        because that is a check you asked for.
      </p>
      ${platformMarkup(state)}
    </section>
    <section class="setting">
      <label>
        <input type="checkbox" class="history-toggle" ${state.historyEnabled ? "checked" : ""} />
        Keep a local history of checks
      </label>
      <p class="hint">
        Stored only in this browser, never sent anywhere. Turning this off does not delete
        history you already have.
      </p>
    </section>
    <section class="setting">
      <label>
        <input
          type="checkbox"
          class="reputation-toggle"
          ${state.reputationLookupEnabled ? "checked" : ""}
        />
        Turn on community checks
      </label>
      <p class="hint">
        Asks whether any reviewer accounts on a page belong to networks flagged across many
        products, using hashed account prefixes mixed with random decoys so no reviewer id,
        product, or identity is ever sent. Off by default. See the privacy page for the full
        protocol.
      </p>
    </section>
    <section class="setting">
      <label>
        <input
          type="checkbox"
          class="contribution-toggle"
          ${state.graphContributionEnabled ? "checked" : ""}
        />
        Help build the reviewer network
      </label>
      <p class="hint">
        Sends hashed identifiers from reviews you have already viewed, batched and held for a
        random delay of one to six hours, so this is not what flags anything on its own: it is
        what the community checks setting above asks against. Off by default. Turning it off
        stops new submissions immediately.
      </p>
      <div class="disclosure" hidden>
        <p><strong>Sent:</strong> a hashed reviewer identifier, a hashed product identifier, the
        star rating, the week the review was posted (not the day), whether it was verified, and
        a similarity fingerprint of the review text that cannot be turned back into the text.</p>
        <p><strong>Never sent:</strong> the review text itself, the product's title, category,
        price, or url, your identity, or anything that could tie a submission to this browser or
        to any other submission from it.</p>
        <p>
          <button type="button" class="contribution-confirm">Confirm</button>
          <button type="button" class="contribution-cancel">Cancel</button>
        </p>
      </div>
    </section>
    <section class="setting">
      <h2>What this browser is holding</h2>
      <!-- PRIVACY.md is a promise about what stays local. A promise the user
           cannot see the state of is a claim, so the counts live here next to
           the switches that produce them. -->
      <dl class="holdings">
        <div>
          <dt>Checks</dt>
          <dd>${checksLine(state.holdings)}</dd>
        </div>
        <div>
          <dt>Watching</dt>
          <dd>${watchedLine(state.holdings)}</dd>
          <dd class="actions">
            <button type="button" class="clear-watchlist" ${state.holdings.watched === 0 ? "disabled" : ""}>
              Stop watching everything
            </button>
          </dd>
        </div>
        <div>
          <dt>Review pages</dt>
          <dd>${cacheLine(state.holdings, now)}</dd>
          <dd class="actions">
            <button type="button" class="clear-cache" ${state.holdings.cachedProducts === 0 ? "disabled" : ""}>
              Clear the review pages
            </button>
          </dd>
        </div>
        <div>
          <dt>Waiting to be sent</dt>
          <dd>${contributionLine(state.holdings, now)}</dd>
          <dd class="actions">
            <button type="button" class="clear-queue" ${state.holdings.queuedContributions === 0 ? "disabled" : ""}>
              Clear what is waiting
            </button>
          </dd>
        </div>
      </dl>
    </section>
    <section class="setting">
      <h2>Your history</h2>
      <div class="actions">
        <button type="button" class="export-json">Export as JSON</button>
        <button type="button" class="export-csv">Export as CSV</button>
        <button type="button" class="import-history">Import from JSON</button>
        <button type="button" class="delete-all">Delete everything</button>
      </div>
      <input type="file" class="import-file" accept="application/json,.json" hidden />
      ${
        state.importMessage === undefined || state.importMessage === null
          ? ""
          : `<p class="hint import-result" role="status">${escapeHtml(state.importMessage)}</p>`
      }
      <!-- PRIVACY.md section 6: history across devices is an export and an import,
           not a server. Only the JSON carries the report and the feature vector,
           so the csv cannot come back in. -->
      <p class="hint">
        Import merges a JSON export from another browser into this one, and never replaces
        what is already here. CSV is for spreadsheets and cannot be imported.
      </p>
      <!-- PRIVACY.md section 6: history is local, so uninstalling takes it
           with it. That is worth one sentence next to the export buttons,
           where somebody is already thinking about their data, as well as
           on the page the uninstall itself opens. -->
      <p class="hint">
        History lives only in this browser. Uninstalling Verdict deletes it, so export first if
        you want to keep it.
      </p>
    </section>
  `;

  bindPolicyNotice(container, { onAcknowledge: callbacks.onAcknowledgePolicy });

  container
    .querySelector<HTMLInputElement>(".analysis-toggle")
    ?.addEventListener("change", (event) => {
      callbacks.onToggleAnalysis((event.target as HTMLInputElement).checked);
    });

  for (const toggle of container.querySelectorAll<HTMLInputElement>(".platform-toggle")) {
    toggle.addEventListener("change", () => {
      const site = toggle.dataset.site;
      if (site !== undefined) {
        // the box says read this platform, the setting it writes says paused
        callbacks.onTogglePlatform(site, !toggle.checked);
      }
    });
  }

  container.querySelector<HTMLInputElement>(".history-toggle")?.addEventListener("change", (event) => {
    callbacks.onToggleHistory((event.target as HTMLInputElement).checked);
  });
  container
    .querySelector<HTMLInputElement>(".reputation-toggle")
    ?.addEventListener("change", (event) => {
      callbacks.onToggleReputationLookup((event.target as HTMLInputElement).checked);
    });

  const contributionToggle = container.querySelector<HTMLInputElement>(".contribution-toggle");
  const disclosure = container.querySelector<HTMLElement>(".disclosure");
  contributionToggle?.addEventListener("change", (event) => {
    const checked = (event.target as HTMLInputElement).checked;
    if (!checked) {
      callbacks.onToggleGraphContribution(false);
      return;
    }
    if (disclosure) {
      disclosure.hidden = false;
    }
  });
  container.querySelector(".contribution-confirm")?.addEventListener("click", () => {
    if (disclosure) {
      disclosure.hidden = true;
    }
    callbacks.onToggleGraphContribution(true);
  });
  container.querySelector(".contribution-cancel")?.addEventListener("click", () => {
    if (disclosure) {
      disclosure.hidden = true;
    }
    if (contributionToggle) {
      contributionToggle.checked = false;
    }
  });

  container.querySelector(".clear-cache")?.addEventListener("click", callbacks.onClearCache);
  container.querySelector(".clear-watchlist")?.addEventListener(
    "click",
    callbacks.onClearWatchlist,
  );
  container.querySelector(".clear-queue")?.addEventListener("click", callbacks.onClearQueue);

  const fileInput = container.querySelector<HTMLInputElement>(".import-file");
  container.querySelector(".import-history")?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file !== undefined) {
      callbacks.onImport(file);
    }
  });

  container.querySelector(".export-json")?.addEventListener("click", callbacks.onExportJson);
  container.querySelector(".export-csv")?.addEventListener("click", callbacks.onExportCsv);

  const deleteButton = container.querySelector<HTMLButtonElement>(".delete-all");
  deleteButton?.addEventListener("click", () => {
    if (deleteButton.dataset.confirming === "true") {
      callbacks.onDeleteAll();
      return;
    }
    deleteButton.dataset.confirming = "true";
    deleteButton.textContent = "Confirm delete";
  });
}

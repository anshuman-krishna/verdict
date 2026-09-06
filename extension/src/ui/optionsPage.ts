export interface OptionsState {
  historyEnabled: boolean;
  reputationLookupEnabled: boolean;
}

export interface OptionsCallbacks {
  onToggleHistory: (enabled: boolean) => void;
  onToggleReputationLookup: (enabled: boolean) => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onDeleteAll: () => void;
}

export function renderOptions(
  container: HTMLElement,
  state: OptionsState,
  callbacks: OptionsCallbacks,
): void {
  container.innerHTML = `
    <header>
      <span class="wordmark">verdict</span>
    </header>
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
      <h2>Your history</h2>
      <div class="actions">
        <button type="button" class="export-json">Export as JSON</button>
        <button type="button" class="export-csv">Export as CSV</button>
        <button type="button" class="delete-all">Delete everything</button>
      </div>
    </section>
  `;

  container.querySelector<HTMLInputElement>(".history-toggle")?.addEventListener("change", (event) => {
    callbacks.onToggleHistory((event.target as HTMLInputElement).checked);
  });
  container
    .querySelector<HTMLInputElement>(".reputation-toggle")
    ?.addEventListener("change", (event) => {
      callbacks.onToggleReputationLookup((event.target as HTMLInputElement).checked);
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

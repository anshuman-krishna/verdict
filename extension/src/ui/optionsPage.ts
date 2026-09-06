export interface OptionsState {
  historyEnabled: boolean;
  reputationLookupEnabled: boolean;
  graphContributionEnabled: boolean;
}

export interface OptionsCallbacks {
  onToggleHistory: (enabled: boolean) => void;
  onToggleReputationLookup: (enabled: boolean) => void;
  onToggleGraphContribution: (enabled: boolean) => void;
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

  // PRIVACY.md section 5: "a screen that lists exactly what is sent, with
  // no pre ticked box and no dark pattern." Checking the box does not by
  // itself enable anything: it reveals the sent/never sent disclosure
  // above and waits for an explicit Confirm click before calling back.
  // Unchecking calls back immediately, since turning it off has nothing
  // to disclose.
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

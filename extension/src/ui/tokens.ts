// DESIGN.md section 4, transcribed verbatim. the panel renders inside a
// closed shadow root (DESIGN.md section 11) so these tokens are defined
// here rather than relying on anything from the host page.
export const DESIGN_TOKENS_CSS = `
:host {
  --paper: #E7ECE3;
  --paper-raised: #F1F4EC;
  --paper-sunk: #DAE1D2;
  --ink: #17251F;
  --ink-soft: #4C5C52;
  --rule: #C0CBB6;
  --accent: #1D5C46;
  --accent-quiet: #C8DACF;
  --violet: #57487F;
  --cancel: #9C382F;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :host {
    --paper: #111A16;
    --paper-raised: #182420;
    --paper-sunk: #0C1310;
    --ink: #E2E9DF;
    --ink-soft: #93A398;
    --rule: #2C3B34;
    --accent: #58B48C;
    --accent-quiet: #1E3830;
    --violet: #9C8ED6;
    --cancel: #D4756A;
  }
}
`;

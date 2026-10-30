# Design: "Plano de obra"

Graphite ink on cool drafting paper. The loan is read like a construction drawing: measured, ruled, precise.

- **Palette** (tokens in `src/styles.css` `:root`): paper `#e9ece8` ground, sheet `#fafbf9` panels, ink `#1b2220` (top bar, primary buttons, rules), plan blue `#1d4f9e` (measured data, links, registered rows), redline `#c2401a` (current period, destructive), green `#1f6b45` (savings), amber `#96600c` (partial / not-yet-due).
- **Type**: Archivo variable (self-hosted, OFL), width axis used for voice: condensed 82–92% for figures and big numbers, 112% for small uppercase drafting labels. Tabular numerals everywhere money appears.
- **Shape**: 4px radius, 1px hairline rules, 1.5px ink rule under page headings and table headers. No shadows except dialogs.
- **Signature move**: the *cota* (dimension line) on the Panel measures capital paid against the amount financed; loan data sits in a *cajetín* (title block) grid.
- **Navigation**: top bar with tabs on desktop; fixed bottom tab bar on phones.
- Editable inputs are white boxes; read-only values (period, scheduled date) are dashed-underline cells, not inputs.

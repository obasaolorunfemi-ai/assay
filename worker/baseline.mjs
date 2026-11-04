// The project's own real runs, counted in the same totals as the apps that report, and always shown separately underneath so nobody mistakes one for the other.
// Each entry is something Assay actually checked, with where it is written up. Add a row only for a run that happened and is documented.
export const BASELINE = [
  { id: 'sample', label: 'The project’s hand-labelled sample: citations written by free models', when: '2026-11-03', link: '/paper/#8-evaluation', counts: { citations: { checked: 30, ok: 12, check: 3, failed: 15 } } },
  { id: 'references', label: 'The references in the project’s two technical papers, checked by Assay itself', when: '2026-11-04', link: '/paper/#7-verifying-the-library', counts: { citations: { checked: 36, ok: 34, check: 2, failed: 0 }, retractions: { checked: 36, ok: 36, check: 0, failed: 0 } } },
];

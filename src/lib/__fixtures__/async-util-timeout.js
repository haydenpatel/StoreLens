// Vitest setup file (see vite.config.js): how long Testing Library's findBy* and
// waitFor wait before giving up. Its 1 s default is too short for a cold render
// under parallel suites; this stays under the 15 s test timeout so a missing
// element fails with a readable message rather than a bare "Test timed out".
import { configure } from "@testing-library/dom";

configure({ asyncUtilTimeout: 10_000 });

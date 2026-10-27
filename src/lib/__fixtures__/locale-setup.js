// Vitest setup file (see vite.config.js): every test runs in en-US, whatever
// the machine's locale. Locale tests call setLocale themselves.
import { beforeEach } from "vitest";
import { setLocale } from "@/lib/locale";

beforeEach(() => setLocale("en-US"));

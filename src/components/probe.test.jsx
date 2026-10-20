// @vitest-environment jsdom
import { it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Slider } from "@/components/ui/slider";
class NoopObserver { observe(){} unobserve(){} disconnect(){} }
globalThis.ResizeObserver = NoopObserver;
it("probe", () => {
  const out = [];
  for (const [min,max] of [[20,20],[20,21]]) {
    const errs=[]; const orig=console.error; console.error=(...a)=>errs.push(String(a[0]).slice(0,200));
    let html, thrown;
    try { const {container}=render(<Slider min={min} max={max} step={1} value={[min,max]} onValueChange={()=>{}}/>); html=container.innerHTML; } catch(e){thrown=e.message}
    console.error=orig;
    out.push({min,max,thrown,errs,html});
  }
  expect(JSON.stringify(out,null,1)).toBe("");
});

import React from "react";
import Notice from "./Notice";
import { Button } from "@/components/ui/button";
import { clearStoreCaches } from "@/lib/store";

// The last line of defence: anything that throws while the page renders would
// otherwise leave a white page that reloading reproduces (a bad cached value
// comes back). Offers a reload, and a reload that first drops the cached store
// data, which is the usual way a bad value survives one.
export default class ErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.reload ?? (() => window.location.reload());
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-background text-foreground">
        <Notice level="error" className="mb-0">
          Something went wrong and the page couldn't be shown. Reloading usually fixes it; if it comes back, clear the saved data and reload.
        </Notice>
        <div className="flex gap-2">
          <Button onClick={() => reload()}>Reload</Button>
          <Button
            variant="outline"
            onClick={() => {
              clearStoreCaches();
              reload();
            }}
          >
            Clear saved data and reload
          </Button>
        </div>
      </div>
    );
  }
}

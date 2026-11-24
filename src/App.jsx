import React from "react"
import StoreLensApp from "./pages/StoreLens"
import ErrorBoundary from "./components/ErrorBoundary"

function App() {
  return (
    <ErrorBoundary>
      <StoreLensApp />
    </ErrorBoundary>
  )
}

export default App

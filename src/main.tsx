import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "./styles.css";

const DRAFT_KEY = "confronto-interventi:bozza:v1";

/** Evita la pagina bianca: mostra l'errore e permette di salvare o scartare la bozza. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { error: String(e) };
  }
  render() {
    if (!this.state.error) return this.props.children;
    let draft: string | null = null;
    try {
      draft = window.localStorage.getItem(DRAFT_KEY);
    } catch {
      draft = null;
    }
    return (
      <div className="app">
        <div className="notice bad" role="alert">
          <h2>Si è verificato un errore</h2>
          <p className="mono">{this.state.error}</p>
          <div className="toolbar">
            {draft && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(new Blob([draft!], { type: "application/json" }));
                  a.download = "bozza-recuperata.json";
                  a.click();
                }}
              >
                Scarica la bozza
              </button>
            )}
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                try {
                  window.localStorage.removeItem(DRAFT_KEY);
                } catch {
                  /* niente da fare */
                }
                window.location.reload();
              }}
            >
              Scarta la bozza e torna alla scelta del percorso
            </button>
          </div>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

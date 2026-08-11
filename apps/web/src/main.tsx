import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ToastProvider } from "./components/Toast";
import { applyTheme, getStoredTheme } from "./lib/theme";
import "react-day-picker/style.css";
import "./fonts.css";
import "./index.css";
import "./loaders.css";

applyTheme(getStoredTheme());

const DAY = 1000 * 60 * 60 * 24;

const queryClient = new QueryClient({
  defaultOptions: {
    // gcTime long : les données restent en cache (donc persistables) hors écran.
    queries: { staleTime: 30_000, gcTime: DAY, refetchOnWindowFocus: false },
  },
});

// Cache persistant (localStorage) : au rechargement / réseau faible, les anciennes
// données s'affichent immédiatement pendant que la requête se rafraîchit en fond.
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: "gfa-query-cache",
});

// On ne persiste que les listes utiles hors-ligne (todos + voyages : agenda + budget),
// pas les données volumineuses/sensibles (transactions bancaires, etc.).
const PERSISTED_KEYS = new Set(["tasks", "trips", "trip-items", "trip-expenses", "members"]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: DAY,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => PERSISTED_KEYS.has(q.queryKey[0] as string),
        },
      }}
    >
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);

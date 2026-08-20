import { Routes, Route, Navigate, useParams, useLocation } from "react-router-dom";
import { useMeQuery, MeProvider } from "./auth";
import Layout from "./components/Layout";
import AppLoader from "./components/AppLoader";
import PageGate from "./components/PageGate";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import Dashboard from "./pages/Dashboard";
import Tasks from "./pages/Tasks";
import Calendar from "./pages/Calendar";
import Money from "./pages/Money";
import Wedding from "./pages/Wedding";
import Courses from "./pages/Courses";
import Repas from "./pages/Repas";
import Tools from "./pages/Tools";
import Films from "./pages/Films";
import Listes from "./pages/Listes";
import Vacances from "./pages/Vacances";
import Sport from "./pages/Sport";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";

/** /courses/idees/<vue> → /repas/idees/<vue> (ancienne URL des idées repas). */
function LegacyIdeasRedirect() {
  const { view } = useParams();
  return <Navigate to={`/repas/idees/${view}`} replace />;
}

/** /tools/<section>/<vue> → /<section>/<vue> (films et vacances sortis de /tools). */
function LegacyToolsRedirect({ base }: { base: string }) {
  const { view } = useParams();
  return <Navigate to={`${base}/${view}`} replace />;
}

/**
 * Chemin inconnu → on remonte d'**un** cran (`/settings/outils/films` →
 * `/settings/outils`) au lieu de retomber sur l'accueil.
 *
 * Pourquoi : le dernier chemin visité de chaque section est mémorisé
 * (`useLastPaths`, localStorage). Quand un sous-menu disparaît ou est renommé,
 * la mémoire pointe sur une URL morte et le menu semblait cassé — un clic sur
 * « Réglages » atterrissait sur l'accueil. En remontant, on retombe sur la page
 * parente, qui réécrit aussitôt la mémoire de la section avec un chemin valide.
 *
 * La boucle se termine d'elle-même : chaque passage retire un segment, donc au
 * pire on finit sur « / ». Pas de table de routes à maintenir en double.
 */
function ParentRedirect() {
  const { pathname } = useLocation();
  const parent = pathname.replace(/\/[^/]*$/, "");
  return <Navigate to={parent && parent !== pathname ? parent : "/"} replace />;
}

export default function App() {
  // `isPending` (et non `isLoading`) : pendant la restauration du cache persistant,
  // la requête « me » est en pause (fetchStatus idle) donc isLoading serait false
  // alors que `me` n'est pas encore chargé → on redirigeait à tort vers /login puis /.
  const { data: me, isPending } = useMeQuery();

  if (isPending) return <AppLoader />;

  if (!me) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Wizard de premier lancement (gardé par SETUP_TOKEN côté API). */}
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <MeProvider me={me}>
      <Layout>
        <Routes>
          <Route path="/" element={<PageGate variant="accueil"><Dashboard /></PageGate>} />
          <Route path="/tasks" element={<PageGate variant="taches"><Tasks /></PageGate>} />
          <Route path="/calendar" element={<PageGate variant="agenda"><Calendar /></PageGate>} />
          <Route path="/calendar/:view" element={<PageGate variant="agenda"><Calendar /></PageGate>} />
          <Route path="/money" element={<PageGate variant="argent"><Money /></PageGate>} />
          <Route path="/money/:tab" element={<PageGate variant="argent"><Money /></PageGate>} />
          <Route path="/money/:tab/:view" element={<PageGate variant="argent"><Money /></PageGate>} />
          <Route path="/wedding" element={<PageGate variant="mariage"><Wedding /></PageGate>} />
          <Route path="/wedding/:tab" element={<PageGate variant="mariage"><Wedding /></PageGate>} />
          <Route path="/courses" element={<PageGate variant="repas"><Courses /></PageGate>} />
          {/* Anciennes URLs : /courses portait aussi recettes et idées repas,
              parties dans /repas. On redirige (liens partagés, dernier chemin
              mémorisé par useLastPaths). */}
          <Route path="/courses/liste" element={<Navigate to="/courses" replace />} />
          <Route path="/courses/recettes" element={<Navigate to="/repas/recettes" replace />} />
          <Route path="/courses/idees" element={<Navigate to="/repas/idees" replace />} />
          <Route path="/courses/idees/:view" element={<LegacyIdeasRedirect />} />
          <Route path="/repas" element={<PageGate variant="repas"><Repas /></PageGate>} />
          <Route path="/repas/:tab" element={<PageGate variant="repas"><Repas /></PageGate>} />
          <Route path="/repas/:tab/:view" element={<PageGate variant="repas"><Repas /></PageGate>} />
          <Route path="/tools" element={<PageGate variant="activites"><Tools /></PageGate>} />
          <Route path="/tools/:tab" element={<PageGate variant="activites"><Tools /></PageGate>} />
          <Route path="/listes" element={<Listes />} />
          <Route path="/listes/:tab" element={<Listes />} />
          <Route path="/listes/:tab/:view" element={<Listes />} />
          <Route path="/tools/wish" element={<Navigate to="/listes/wishlist" replace />} />
          <Route path="/tools/wish/:view" element={<LegacyToolsRedirect base="/listes/wishlist" />} />
          <Route path="/films" element={<PageGate variant="activites"><Films /></PageGate>} />
          <Route path="/films/:view" element={<PageGate variant="activites"><Films /></PageGate>} />
          <Route path="/vacances" element={<PageGate variant="activites"><Vacances /></PageGate>} />
          <Route path="/vacances/:view" element={<PageGate variant="activites"><Vacances /></PageGate>} />
          {/* Un voyage ouvert est une sous-page : /vacances/<vue>/<id>/<onglet>. */}
          <Route path="/vacances/:view/:tripId" element={<PageGate variant="activites"><Vacances /></PageGate>} />
          <Route path="/vacances/:view/:tripId/:tab" element={<PageGate variant="activites"><Vacances /></PageGate>} />
          {/* Anciennes URLs : films et vacances étaient des onglets de /tools. */}
          <Route path="/tools/films" element={<Navigate to="/films" replace />} />
          <Route path="/tools/films/:view" element={<LegacyToolsRedirect base="/films" />} />
          <Route path="/tools/vacances" element={<Navigate to="/vacances" replace />} />
          <Route path="/tools/vacances/:view" element={<LegacyToolsRedirect base="/vacances" />} />
          <Route path="/sport" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/sport/:member" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/sport/:member/:view" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/sport/:member/:view/:sub" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:section" element={<Settings />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          {/* Dernier recours : la page parente, pas l'accueil (cf. ParentRedirect). */}
          <Route path="*" element={<ParentRedirect />} />
        </Routes>
      </Layout>
    </MeProvider>
  );
}

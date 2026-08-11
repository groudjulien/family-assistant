import { Routes, Route, Navigate } from "react-router-dom";
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
import Tools from "./pages/Tools";
import Sport from "./pages/Sport";
import Chat from "./pages/Chat";
import Settings from "./pages/Settings";

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
          <Route path="/courses/:tab/:view" element={<PageGate variant="repas"><Courses /></PageGate>} />
        <Route path="/courses/:tab" element={<PageGate variant="repas"><Courses /></PageGate>} />
          <Route path="/tools" element={<PageGate variant="activites"><Tools /></PageGate>} />
          <Route path="/tools/:tab" element={<PageGate variant="activites"><Tools /></PageGate>} />
          <Route path="/tools/:tab/:view" element={<PageGate variant="activites"><Tools /></PageGate>} />
          <Route path="/sport" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/sport/:member" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/sport/:member/:view" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/sport/:member/:view/:sub" element={<PageGate variant="bienetre"><Sport /></PageGate>} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/:section" element={<Settings />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </MeProvider>
  );
}

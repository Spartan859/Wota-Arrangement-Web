import { BrowserRouter, Route, Routes } from "react-router-dom";
import App from "./App";
import { AdminPage } from "./components/AdminPage";
import { MySharesPage } from "./components/MySharesPage";
import { PublicSharePage } from "./components/PublicSharePage";
import { SessionProvider } from "./session";

export function AppRouter() {
  return (
    <BrowserRouter>
      <SessionProvider>
        <Routes>
          <Route path="/" element={<App />} />
          <Route path="/s/:token" element={<PublicSharePage />} />
          <Route path="/shares" element={<MySharesPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<App />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}

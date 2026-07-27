import { useEffect, useState } from "react";
import Home from "./pages/Home";
import Submit from "./pages/Submit";
import Admin from "./pages/Admin";
import "./App.css";

function getRoute() {
  const hash = window.location.hash.replace("#", "") || "/";
  return hash;
}

export default function App() {
  const [route, setRoute] = useState(getRoute());

  useEffect(() => {
    function onHashChange() {
      setRoute(getRoute());
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  let page;
  if (route.startsWith("/submit")) {
    page = <Submit />;
  } else if (route.startsWith("/admin")) {
    page = <Admin />;
  } else {
    page = <Home />;
  }

  return (
    <div className="app">
      <nav className="navbar">
        <a href="#/" className="navbar__brand">
          Telehub
        </a>
        <div className="navbar__links">
          <a href="#/">Jelajah</a>
          <a href="#/submit">Promosikan Server</a>
        </div>
      </nav>

      <main>{page}</main>

      <footer className="footer">
        <span>Telehub — direktori server Discord Indonesia</span>
        <a href="#/admin">Admin</a>
      </footer>
    </div>
  );
}

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import App from "./App";
import CloudGate from "./CloudGate";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <CloudGate>
        <App />
      </CloudGate>
    </BrowserRouter>
  </React.StrictMode>,
);

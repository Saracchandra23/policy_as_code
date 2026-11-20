import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createContainer } from "./di/container";
import App from "./App";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("The frontend root element is missing");
}

const { controller } = createContainer();

createRoot(rootElement).render(
  <StrictMode>
    <App client={controller} />
  </StrictMode>,
);

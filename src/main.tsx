import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (new URLSearchParams(location.search).has("posetest")) import("./posetest").then((m) => m.poseTest());
else createRoot(document.getElementById("root")!).render(<App />);

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { Splash } from "./view/Splash.js";
import "./ui.css";

// the open project names the window (2026-11-12, a project is a folder)
if (window.projectNow?.name) document.title = `${window.projectNow.name} — BIM-BEM-BOM`;

createRoot(document.getElementById("root")!).render(<><App /><Splash /></>);

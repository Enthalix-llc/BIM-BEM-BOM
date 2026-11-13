// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Enthalix LLC
//
// The rail: BIM · BEM · BOM down the far left, a freshness dot on each. The
// dot is the chain check made visible — green when the module's file names
// the upstream content it was built from, amber when the upstream was
// rebuilt since, hollow when the module has not been built yet.

import { projectBadge } from "../core/projectSources.js";
import { MODULES, type AppModule } from "./registry.js";

export type DotState = "ok" | "stale" | "absent";

export function Rail(props: {
  active: AppModule;
  dots: Record<AppModule, DotState>;
  onSelect: (m: AppModule) => void;
}): React.ReactElement {
  return (
    <nav className="rail" aria-label="modules">
      {MODULES.map((m) => {
        const dot = props.dots[m.id];
        return (
          <button
            key={m.id}
            className={`railItem${props.active === m.id ? " on" : ""}`}
            style={{ ["--accent" as string]: `var(${m.accentVar})` }}
            title={`${m.title}${dot === "stale" ? " — STALE: the upstream file was rebuilt since" : dot === "absent" ? " — not built yet" : " — fresh"}`}
            onClick={() => props.onSelect(m.id)}
          >
            <span className={`dot ${dot}`} aria-label={dot} />
            <span className="railLabel">{m.label}</span>
          </button>
        );
      })}
      {projectBadge() && <span className="railHouse" title={`the open project, ${window.projectNow?.name ?? ""}, carries this mark`}>{projectBadge()}</span>}
    </nav>
  );
}

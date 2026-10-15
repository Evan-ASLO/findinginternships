"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import Link from "next/link";
import { activeStage, concepts, demoReducer, initialDemo, progressAt, stages } from "../lib/tour-data.mjs";
import ToolDemo from "./ToolDemo.jsx";

function Cup() {
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path d="M6 10h17v9a7 7 0 0 1-7 7h-3a7 7 0 0 1-7-7zM23 12h2a5 5 0 0 1 0 10h-2M11 4v3M17 3v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>;
}

export default function Tour({ concept }) {
  const info = concepts[concept], root = useRef(null), rail = useRef(null), path = useRef(null);
  const [enhanced, setEnhanced] = useState(false), [percent, setPercent] = useState(0), [active, setActive] = useState(0);
  const [context, setContext] = useState("request"), [theme, setTheme] = useState("light"), [submitted, setSubmitted] = useState(false);
  const [demo, dispatch] = useReducer(demoReducer, initialDemo);
  useEffect(() => {
    setEnhanced(true);
    const query = new URLSearchParams(location.search);
    setContext(query.get("context") === "welcome" ? "welcome" : "request");
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    let frame = 0;
    const update = () => {
      frame = 0;
      const stops = [...root.current.querySelectorAll("[data-progress-stop]")].map((node) => node.getBoundingClientRect().top + window.scrollY - 156);
      const progress = progressAt(window.scrollY, stops);
      rail.current?.style.setProperty("--tour-progress", String(progress));
      path.current?.setAttribute("stroke-dashoffset", String(1 - progress));
      setPercent(Math.round(progress * 100));
      setActive(activeStage(progress));
    };
    const schedule = () => { if (!frame && !document.hidden) frame = requestAnimationFrame(update); };
    const visible = () => { if (document.hidden && frame) { cancelAnimationFrame(frame); frame = 0; } else schedule(); };
    window.addEventListener("scroll", schedule, { passive: true }); window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", visible);
    const observer = new ResizeObserver(schedule); observer.observe(root.current);
    update();
    return () => { window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); document.removeEventListener("visibilitychange", visible); observer.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, []);
  function jump(event, id) {
    event.preventDefault();
    const node = document.getElementById(id);
    if (!node) return;
    history.replaceState(null, "", `#${id}`);
    node.focus({ preventScroll: true });
    window.scrollTo({ top: node.getBoundingClientRect().top + window.scrollY - 156, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  function switchContext(value) {
    setContext(value); setSubmitted(false);
    const url = new URL(location.href); url.searchParams.set("context", value); history.replaceState(null, "", url);
  }
  function switchTheme() {
    const next = theme === "light" ? "dark" : "light"; setTheme(next); document.documentElement.dataset.theme = next;
    const url = new URL(location.href); url.searchParams.set("scoutTheme", next); history.replaceState(null, "", url);
  }
  function replay(event) {
    dispatch({ type: "reset" }); setSubmitted(false); jump(event, "find");
  }
  const progressNav = <nav className="chapter-nav" aria-label="Tour chapters">{stages.map((stage, index) => <a key={stage.id} href={`#${stage.id}`} onClick={(e) => jump(e, stage.id)} aria-current={active === index ? "step" : undefined}><span className="chapter-index">{index + 1}</span><span>{stage.label}</span><small>{index * 25}%</small></a>)}</nav>;
  return <div ref={root} className={`tour tour-${concept} ${enhanced ? "enhanced" : ""}`} data-concept={concept}>
    <span hidden dangerouslySetInnerHTML={{ __html: `<!-- ${info.contract} -->` }} />
    <a className="skip-link" href="#access" onClick={(e) => jump(e, "access")}>Skip tour to preview access</a>
    <header className="preview-header">
      <Link className="brand" href="/"><img src="/brand/finding-internships.png" width="32" height="32" alt="" aria-hidden="true" className="brand-image" /><span>Finding Internships<small>Local onboarding prototypes</small></span></Link>
      <div className="header-actions"><Link href="/" className="comparison-back">Compare all three</Link><button onClick={switchTheme} aria-label={`Preview ${theme === "light" ? "dark" : "light"} theme`}>{theme === "light" ? "Dark" : "Light"}</button></div>
    </header>
    <div className="preview-context"><span>Simulation only · no accounts or providers connected</span><label htmlFor="preview-context">Preview context<select id="preview-context" value={context} onChange={(e) => switchContext(e.target.value)}><option value="request">Requesting access</option><option value="welcome">First approved login</option></select></label></div>
    <noscript><p className="preview-context">JavaScript is off. Read all four chapters below; the interactive simulations and live tour-progress indicator require JavaScript. No request will be submitted.</p></noscript>
    <section className="tour-opening">
      <div><h1>{info.headline.split("\n").map((line, index) => <span key={line}>{index > 0 && <><span className="headline-space"> </span><br /></>}{line}</span>)}</h1><p>{context === "request" ? "Try four useful tools before requesting access." : "First-approved-login simulation: try the tools before exploring your workspace."} Scroll or choose a chapter. Every action here is fictional.</p></div>
      <div className="opening-aside"><strong>{info.name}</strong><p>{info.description}</p><a href="#find" onClick={(e) => jump(e, "find")}>Begin the four-part tour <span aria-hidden="true">↓</span></a></div>
    </section>
    <div className="tour-progress" ref={rail}>
      <div className="progress-label"><span>Tour progress, not application progress</span><strong>{percent}%</strong></div>
      <div className="quarter-track" role="progressbar" aria-label="Four-part tour progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={percent} aria-valuetext={`${percent}% of the tool tour; not a job outcome`}><div className="progress-fill" /><span /><span /><span /></div>
    </div>
    <div className="tour-body">
      {concept === "chapters" && <aside className="contents"><p>Four tools. Your pace.</p>{progressNav}<a href="#access" onClick={(e) => jump(e, "access")}>Skip to access preview →</a></aside>}
      {concept === "map" && <aside className="route-map">
        <svg viewBox="0 0 420 640" aria-hidden="true" className="journey-route">
          <path className="route-underlay" d="M90 75 C90 155 325 130 325 225 S80 300 80 380 S300 470 300 560" />
          <path ref={path} pathLength="1" strokeDasharray="1" strokeDashoffset="1" className="route-ink" d="M90 75 C90 155 325 130 325 225 S80 300 80 380 S300 470 300 560" />
          {[[90, 75], [325, 225], [80, 380], [300, 560]].map(([x, y], index) => <g key={index}><circle className={active === index ? "route-stop current" : "route-stop"} cx={x} cy={y} r="24" /><text x={x} y={y + 6} textAnchor="middle">{index + 1}</text></g>)}
          <g className="route-sketch"><path d="M155 435h45v28h-45zM162 430v-8h30v8M200 441h8a8 8 0 0 1 0 16h-8" /><text x="176" y="494" textAnchor="middle">One step at a time</text></g>
        </svg>{progressNav}
      </aside>}
      <div className="chapter-sequence">
        {stages.map((stage, index) => <section className={`chapter chapter-${index} ${active === index ? "current-chapter" : ""}`} key={stage.id}>
          <h2 id={stage.id} tabIndex="-1" data-progress-stop><span className="chapter-number">{index + 1} / 4 · {stage.tool}</span><span className="long-title">{stage.title}</span><span className="short-title">{stage.shortTitle}</span></h2>
          <p className="chapter-copy">{stage.copy}</p>
          <div className="chapter-demo"><ToolDemo index={index} demo={demo} dispatch={dispatch} prefix={`chapter-${index}`} /></div>
          <p className="chapter-note">{stage.note}</p>
          <a className="next-chapter" href={`#${index < 3 ? stages[index + 1].id : "access"}`} onClick={(e) => jump(e, index < 3 ? stages[index + 1].id : "access")}>{index < 3 ? `Next: ${stages[index + 1].label}` : "Finish the tour"} <span aria-hidden="true">→</span></a>
        </section>)}
      </div>
      {concept === "workspace" && <aside className="pinned-workspace">
        <div className="workspace-identity"><Cup /><span>Northlight Example Foundation <small>One fictional role · four useful tools</small></span></div>
        <div className="pinned-scene" key={active}><ToolDemo index={active} demo={demo} dispatch={dispatch} prefix="pinned" /></div>
        {progressNav}
        <p className="scene-note">The scene follows your scroll. Sample actions remain yours to choose.</p>
      </aside>}
    </div>
    <section className="access-close" aria-labelledby="access">
      <h2 id="access" data-progress-stop tabIndex="-1">{context === "request" ? "See yourself using it?" : "You have seen the tools. Make the next step yours."}</h2>
      <p className="finish-copy">You have reached the end of the tool tour—not an application milestone. Offers and return offers are possible outcomes, never guaranteed. You record them yourself.</p>
      <div className="access-grid">
        <div className="access-letter"><img src="/brand/finding-internships.png" width="40" height="40" alt="" aria-hidden="true" className="brand-image" /><h3>A little closer to what&apos;s next.</h3><p>Find an opportunity, keep a private next-step note and introduce yourself thoughtfully. The workspace supports your decisions; it does not make them for you.</p><button className="secondary" onClick={replay}>Replay & reset sample actions</button><Link href="/">Back to the three previews</Link></div>
        {context === "request" ? <form className="access-form" onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}>
          <h3>Try an access request</h3><p>This form is a local simulation. Use the supplied fictional details; no information leaves this page.</p>
          <label htmlFor="sample-name">Sample name<input id="sample-name" defaultValue="Alex Example" required maxLength="100" autoComplete="off" /></label>
          <label htmlFor="sample-email">Sample email<input id="sample-email" type="email" defaultValue="alex@example.test" required maxLength="200" autoComplete="off" /></label>
          <button className="primary" disabled={!enhanced || submitted}>{submitted ? "Request simulated" : "Simulate access request"}</button>
          {submitted && <p role="status" className="feedback">Simulation only. No real access request was submitted, no account was created, and nothing was saved.</p>}
        </form> : <div className="welcome-action"><h3>Your fictional workspace is ready to explore.</h3><p>This preview assumes approval. It does not sign you in, grant access or change the real website.</p><button className="primary" onClick={() => setSubmitted(true)}>Simulate entering My jobs</button>{submitted && <div className="welcome-receipt" role="status"><strong>My jobs · local preview</strong><p>Public Policy Research Co-op · {demo.stage.toLowerCase()}</p><p>No real login occurred. Your sample actions remain in this page only.</p><a href="#track" onClick={(e) => jump(e, "track")}>Revisit the tracking demo →</a></div>}</div>}
      </div>
    </section>
    <footer className="tour-footer"><span>Original Next.js / JavaScript prototypes · no live-site changes</span><a href="#find" onClick={(e) => jump(e, "find")}>Back to the first tool ↑</a></footer>
  </div>;
}

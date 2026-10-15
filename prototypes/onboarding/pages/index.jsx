import Link from "next/link";
import { concepts } from "../lib/tour-data.mjs";

export default function Comparison() {
  return <main className="comparison">
    <div className="comparison-heading"><span className="wordmark"><img src="/brand/finding-internships.png" width="32" height="32" alt="" aria-hidden="true" className="brand-image" /> Finding Internships</span><span className="preview-stamp">Local prototypes · fictional only</span></div>
    <h1>Three ways to<br />begin your journey.</h1>
    <p className="comparison-intro">Same honest tools. Three different ways to experience them. Open a preview, scroll through the four stages, and try the sample interactions.</p>
    <div className="concept-list">
      {Object.entries(concepts).map(([slug, concept], index) => <Link href={`/${slug}/`} key={slug} className={`concept-link concept-${slug}`}>
        <div className="concept-mini" aria-hidden="true">
          {slug === "workspace" ? <><span className="mini-rail" /><span className="mini-workspace"><i /><i /><i /></span></> :
            slug === "chapters" ? <><span className="mini-column"><i /><i /><i /></span><span className="mini-page"><b /><i /><i /></span></> :
              <svg viewBox="0 0 240 110"><path d="M18 90 C70 90 50 20 105 20 S160 92 215 45" /><circle cx="18" cy="90" r="6" /><circle cx="105" cy="20" r="6" /><circle cx="215" cy="45" r="6" /></svg>}
        </div>
        <div><span className="concept-number">Prototype {index + 1}</span><h2>{concept.name}</h2><p>{concept.description}</p><strong>Open working preview <span aria-hidden="true">→</span></strong></div>
      </Link>)}
    </div>
    <p className="comparison-note">Switch between access-request and first-approved-login contexts inside each preview. All roles, people, resumes, requests and outcomes are fictional. Nothing is uploaded, sent or saved outside the current page.</p>
  </main>;
}

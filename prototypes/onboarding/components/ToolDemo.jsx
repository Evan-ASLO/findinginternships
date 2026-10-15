"use client";

export default function ToolDemo({ index, demo, dispatch, prefix }) {
  const update = (type, value) => dispatch({ type, value });
  return <div className={`tool-demo tool-${index}`} data-tool-stage={index}>
    <div className="tool-chrome"><span className="tool-dots" aria-hidden="true"><i /><i /><i /></span><span>{["Find jobs", "My jobs", "People · review first", "My jobs · outcome"][index]}</span><span className="sample-tag">Fictional example</span></div>
    {index === 0 && <div className="search-tool">
      <form onSubmit={(e) => { e.preventDefault(); update("search"); }}>
        <label htmlFor={`${prefix}-search`}>Search a sample role</label>
        <div className="search-line"><input id={`${prefix}-search`} value={demo.query} onChange={(e) => update("query", e.target.value)} placeholder="Role or company" /><button className="primary">Try search</button></div>
      </form>
      {demo.searched && <p role="status" className="feedback">{/policy|research|intern|example|student/i.test(demo.query) ? "One fictional match. No catalog search or provider call was made." : "The demo keeps one sample role visible. No real search was made."}</p>}
      <div className="role-sheet"><div className="role-title"><span className="employer-mark" aria-hidden="true">NE</span><div><p>Northlight Example Foundation</p><h3>Public Policy Research Co-op</h3></div></div>
        <p className="role-location">Ottawa, Ontario · Canada</p><div className="role-tags"><span>Public policy</span><span>Government & Nonprofit</span><span>4 months · fictional</span></div>
        <p>Sample qualification: current undergraduate enrolment in Public Policy, Political Science or a related programme. Check the real posting before applying.</p>
        <button className={demo.saved ? "secondary" : "primary"} onClick={() => update("save")}>{demo.saved ? "Saved in this demo" : "Save sample role"}</button>
        {demo.saved && <p className="feedback" role="status">Added to the fictional My jobs workspace. Nothing is persisted.</p>}
      </div>
    </div>}
    {index === 1 && <div className="tracking-tool">
      <div className="tracking-heading"><span>Private workspace · sample record</span><strong className="stage-badge">{demo.stage}</strong></div>
      <h3>Public Policy Research Co-op</h3><p>Northlight Example Foundation</p>
      {!demo.saved && <button onClick={() => update("save")}>Add the sample role to this demo</button>}
      <div className="form-grid"><label htmlFor={`${prefix}-stage`}>Current stage<select id={`${prefix}-stage`} value={demo.stage} onChange={(e) => update("stage", e.target.value)}>{["SAVED", "APPLIED", "INTERVIEWING", "OFFER", "REJECTED", "ARCHIVED"].map((stage) => <option key={stage}>{stage}</option>)}</select></label>
        <label htmlFor={`${prefix}-notes`}>Private next-step note<textarea id={`${prefix}-notes`} rows="3" maxLength="500" value={demo.notes} onChange={(e) => update("notes", e.target.value)} /></label></div>
      <p className="feedback">Edits stay in this page only. Saved and Archived are not applications.</p>
      <div className="status-ledger"><span>Current application count in this demo</span><strong>{["APPLIED", "INTERVIEWING", "OFFER", "REJECTED"].includes(demo.stage) ? "1" : "0"}</strong></div>
    </div>}
    {index === 2 && <div className="outreach-tool">
      <div className="contact-heading"><span className="person-mark" aria-hidden="true">JR</span><div><h3>Jordan Rivera</h3><p>Fictional junior policy analyst · example employer</p></div></div>
      <p>Illustrated role peer, not a verified person or real contact.</p>
      <div className="approval-row"><span>Contact preparation</span><button className="secondary" onClick={() => update("prepare")} disabled={demo.prepared}>{demo.prepared ? "Sample prepared" : "Approve sample preparation"}</button></div>
      {demo.prepared ? <div className="draft-sheet"><div><strong>To: jordan@example.test</strong><span>Fictional draft · no delivery</span></div><h4>A question about your policy team</h4><p>Hi Jordan, I&apos;m exploring a policy co-op and would appreciate hearing how your team approaches legislative research. Would you be open to a brief conversation?</p>
        <label className="check-line"><input type="checkbox" checked={demo.attachment} onChange={() => update("attachment")} /><span>Attach the fictional sample resume <small>No file is read or uploaded.</small></span></label>
        {demo.attachment && <div className="resume-slip"><span aria-hidden="true">▤</span><span>Alex Example · Sample resume.pdf</span><span>Illustration only</span></div>}
        <div className="draft-actions"><button onClick={() => update("review")} disabled={demo.reviewed}>{demo.reviewed ? "Draft reviewed" : "Review sample draft"}</button><button className="primary" disabled={!demo.reviewed || demo.sent} onClick={() => update("send")}>{demo.sent ? "Email simulated" : "Approve & simulate email"}</button></div>
      </div> : <p className="waiting-draft">Approve sample preparation to reveal the draft. This does not approve an email.</p>}
      <p className="feedback" role="status">{demo.sent ? "Simulation only: no email was sent. A real reply would not automatically mean a coffee chat." : "Preparation and the actual email require separate approvals. No provider is connected."}</p>
    </div>}
    {index === 3 && <div className="outcome-tool">
      <div className="outcome-paper"><span className="paper-tab">Your record, your next step</span><h3>Leave a note for what comes next.</h3><p>An offer or return offer is one possible outcome, not a promise. Record only what actually happens.</p>
        <label htmlFor={`${prefix}-outcome`}>Try a current outcome<select id={`${prefix}-outcome`} value={demo.outcome} onChange={(e) => update("outcome", e.target.value)}><option value="APPLIED">Applied · still considering next steps</option><option value="INTERVIEWING">Interviewing</option><option value="OFFER">Offer · possible return-offer example</option><option value="REJECTED">Rejected</option><option value="ARCHIVED">Archived</option></select></label>
        <button className="primary" onClick={() => update("record")}>Record sample outcome</button>
        {demo.outcomeRecorded && <p className="feedback" role="status">Recorded {demo.outcome.toLowerCase()} in this fictional page only. No offer was earned, issued or confirmed by the tour.</p>}
      </div><p className="outcome-foot">A current-status snapshot. Not inferred conversion rates or a log of past transitions.</p>
    </div>}
  </div>;
}

export const stages = [
  { id: "find", label: "Find a role", title: "Start with a role worth a closer look.", shortTitle: "Find a role worth saving.",
    copy: "Browse Canada-eligible placements. Check each posting's programme requirements and availability; career track and employer industry stay separate.",
    note: "A useful shortlist starts with one real opportunity.", tool: "Find jobs" },
  { id: "track", label: "Save & track", title: "Keep the role. Leave yourself a next step.", shortTitle: "Keep your next step beside it.",
    copy: "Save the role to My jobs, update its current stage and keep private notes beside it. Found a role elsewhere? You can add it privately, without putting it in the public catalog.",
    note: "Saved and Archived roles are not applications.", tool: "My jobs" },
  { id: "connect", label: "Reach out", title: "A thoughtful introduction, on your terms.", shortTitle: "Reach out, on your terms.",
    copy: "Find People for the role. Approve a contact for preparation first, then review and approve the actual draft separately before email. Attaching a resume is optional and needs your explicit choice.",
    note: "Opening People is not a search. A reply is not automatically a coffee chat.", tool: "People" },
  { id: "outcome", label: "Record an outcome", title: "Whatever happens, keep your next step in sight.", shortTitle: "Record what actually happens.",
    copy: "Record an offer or possible return offer yourself when you receive one. Or keep applying, revisit a contact, or archive the role. The workspace supports the process; it cannot promise the outcome.",
    note: "Offers are not guaranteed. Current statuses are not transition history.", tool: "Your next step" },
];

export const concepts = {
  workspace: {
    name: "Pinned Workspace", description: "One role stays in view while the tools around it change.",
    headline: "One opportunity.\nA workspace that grows with it.",
    contract: "THESIS: One fictional role travels through a persistent working desk, not a generic card carousel. OWN-WORLD: Warm CP cream/clay, Georgia display and Segoe UI tool chrome. STORY: Find, track, separately approve outreach, manually record a possible outcome. FIRST VIEWPORT: Compact welcome beside a full-size searchable role workspace; quarter rail above the scene. FORM: User-pinned prototype 1, native sticky desk; seed exempt because the brief pins all three comparison structures.",
  },
  chapters: {
    name: "Chapter Guide", description: "A clear, reading-first guide with each tool ready to try.",
    headline: "A little direction.\nThen make it your own.",
    contract: "THESIS: A field guide to useful tools, not an abstract motivational path. OWN-WORLD: Warm CP surfaces, generous editorial Georgia chapters and compact Segoe UI controls. STORY: Read each chapter and try its honest simulation; use a sticky contents rail to revisit any stage. FIRST VIEWPORT: Left contents and introductory thesis beside a full-width first chapter with live sample search. FORM: User-pinned prototype 2, editorial chapter/contents staging; seed exempt for explicitly requested alternatives.",
  },
  map: {
    name: "Journey Map", description: "A drawn route joins the tools without inventing achievements.",
    headline: "Your route is yours.\nThese tools travel with you.",
    contract: "THESIS: An original route connects practical tool scenes, never a guaranteed march to an offer. OWN-WORLD: CP cream/clay route ink, warm paper and Georgia station headings. STORY: Follow or jump around a four-stop tool tour; progress reflects scroll only. FIRST VIEWPORT: Large authored SVG route at left, opening search station at right, useful controls on the path. FORM: User-pinned prototype 3, spatial route/alternating station staging; seed exempt for the user's three-prototype comparison.",
  },
};

export const initialDemo = {
  searched: false, query: "policy", saved: false, stage: "SAVED", notes: "Compare programme requirements, then tailor my application.",
  prepared: false, reviewed: false, attachment: false, sent: false, outcome: "APPLIED", outcomeRecorded: false,
};

export function progressAt(scrollPosition, stops) {
  if (!Array.isArray(stops) || stops.length !== 5 || stops.some((value, index) => !Number.isFinite(value) || (index && value <= stops[index - 1]))) {
    throw new Error("Tour progress requires five increasing chapter boundaries.");
  }
  if (scrollPosition <= stops[0]) return 0;
  if (scrollPosition >= stops[4]) return 1;
  const boundary = stops.findIndex((value) => Math.abs(value - scrollPosition) <= 1);
  if (boundary >= 0) return boundary / 4;
  const interval = stops.findIndex((end, index) => index > 0 && scrollPosition < end) - 1;
  return (interval + (scrollPosition - stops[interval]) / (stops[interval + 1] - stops[interval])) / 4;
}

export function activeStage(progress) {
  return Math.min(3, Math.max(0, Math.floor(progress * 4)));
}

export function demoReducer(state, action) {
  switch (action.type) {
    case "query": return { ...state, query: action.value };
    case "search": return { ...state, searched: true };
    case "save": return { ...state, saved: true };
    case "stage": return { ...state, stage: action.value };
    case "notes": return { ...state, notes: action.value };
    case "prepare": return { ...state, prepared: true };
    case "review": return state.prepared ? { ...state, reviewed: true } : state;
    case "attachment": return { ...state, attachment: !state.attachment };
    case "send": return state.prepared && state.reviewed ? { ...state, sent: true } : state;
    case "outcome": return { ...state, outcome: action.value, outcomeRecorded: false };
    case "record": return { ...state, outcomeRecorded: true };
    case "reset": return { ...initialDemo };
    default: return state;
  }
}

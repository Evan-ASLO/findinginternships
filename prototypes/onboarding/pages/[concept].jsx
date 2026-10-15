import Tour from "../components/Tour.jsx";
import { concepts } from "../lib/tour-data.mjs";

export function getStaticPaths() {
  return { paths: Object.keys(concepts).map((concept) => ({ params: { concept } })), fallback: false };
}
export function getStaticProps({ params }) {
  return { props: { concept: params.concept } };
}
export default function ConceptPage({ concept }) {
  return <Tour key={concept} concept={concept} />;
}

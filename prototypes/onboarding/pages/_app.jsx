import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return <>
    <Head>
      <title>Internship &amp; Coffee Chat | Three onboarding previews</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content="Fictional, local-only Next.js onboarding concepts. No access requests, emails or uploads are submitted." />
      <meta name="robots" content="noindex,nofollow" />
    </Head>
    <Component {...pageProps} />
  </>;
}

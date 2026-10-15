import Head from "next/head";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
  return <>
    <Head>
      <title>Finding Internships | Three onboarding previews</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="description" content="Fictional, local-only Next.js onboarding concepts. No access requests, emails or uploads are submitted." />
      <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" type="image/png" sizes="32x32" href="/brand/finding-internships-32.png" />
      <link rel="apple-touch-icon" sizes="180x180" href="/brand/finding-internships-180.png" />
      <meta name="application-name" content="Finding Internships" />
      <meta property="og:site_name" content="Finding Internships" />
      <meta property="og:image" content="/brand/finding-internships.png" />
      <meta property="og:image:width" content="512" /><meta property="og:image:height" content="512" />
    </Head>
    <Component {...pageProps} />
  </>;
}

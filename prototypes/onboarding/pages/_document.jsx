import { Html, Head, Main, NextScript } from "next/document";

const themeScript = `(() => {
  const param = new URLSearchParams(window.location.search).get("scoutTheme");
  const theme =
    param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
})();`;

export default function Document() {
  return <Html lang="en">
    <Head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></Head>
    <body><Main /><NextScript /></body>
  </Html>;
}

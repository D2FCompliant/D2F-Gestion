export default function Home() {
  return (
    <main className="web-app-shell">
      <iframe
        className="web-app-frame"
        src="/erp/index.html?v=20260716-web-pdf-pa-v1"
        title="D2F Gestion"
        allow="clipboard-read; clipboard-write"
      />
      <noscript>D2F Gestion nécessite JavaScript pour fonctionner.</noscript>
    </main>
  );
}

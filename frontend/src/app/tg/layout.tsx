import Script from "next/script";

/* Standalone layout for the Telegram Mini App — no app sidebar or marketing
   chrome. Loads the Telegram WebApp SDK. */
export default function TgLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <div className="min-h-screen bg-mist">{children}</div>
    </>
  );
}

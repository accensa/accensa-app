import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { Nav } from '@/components/nav';
import { Footer } from '@/components/footer';
import { OfflineBanner } from '@/components/network-status';
import { I18nProvider } from '@/i18n/I18nProvider';
import { SessionRenewal } from '@/components/SessionRenewal';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

const bellavoir = localFont({
  src: '../../public/fonts/BellavoirSerif_PERSONAL_USE_ONLY.otf',
  variable: '--font-bellavoir',
  display: 'swap',
});

const camiro = localFont({
  src: '../../public/fonts/Camiro.ttf',
  variable: '--font-camiro',
  display: 'swap',
});

const harabara = localFont({
  src: '../../public/fonts/Harabara.ttf',
  variable: '--font-harabara',
  display: 'swap',
});

const title = 'Accensa - provable payments for x402 sellers on Stellar';
const description =
  'Agents prove they were charged correctly. Merchants refund without becoming custodians. Receipts anchored on Stellar, verifiable by anyone without an account.';

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL('https://accensa-dashboard.vercel.app'),
  openGraph: { title, description, type: 'website', siteName: 'Accensa' },
  twitter: { card: 'summary_large_image', title, description },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${bellavoir.variable} ${camiro.variable} ${harabara.variable} h-full antialiased`}
    >
      <head>
        {/* Runs before first paint so the reveal animation never flashes, and
 gates it on scripting actually working. See globals.css. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var d=document.documentElement;d.classList.add('js');setTimeout(function(){if(d.dataset.srReady!=='1')d.classList.remove('js')},3000)})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col bg-slate-50 dark:bg-[#04090f] transition-colors duration-300 relative">
        {/* defaultTheme is the fallback used only when localStorage holds no
 choice, so"system"gives a first-time visitor whatever their OS is set
 to while an explicit pick from the toggle still wins on every visit.
 It was"dark", which ignored prefers-color-scheme entirely. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <I18nProvider>
            <SessionRenewal />
            <Nav />
            {children}
            <Footer />
            {/* Outside the page tree so it survives navigation and stays visible
 when a page-level error boundary takes over the content area. */}
            <OfflineBanner />
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

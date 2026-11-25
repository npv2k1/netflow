import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

function resolveMetadataBase(): URL {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.APP_URL || 'http://localhost:3000');

  try {
    return new URL(raw);
  } catch {
    return new URL('http://localhost:3000');
  }
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title: 'NetFlow Studio — Vẽ Sơ Đồ Mạng & Mô Phỏng Gói Tin',
  description:
    'Công cụ vẽ sơ đồ mạng trực quan bằng kéo thả cho người không chuyên, hỗ trợ xem luồng gói tin theo từng chặng, đa card mạng DHCP/IP tĩnh và trợ lý AI thiết kế sơ đồ mạng tự động.',
  keywords: [
    'vẽ sơ đồ mạng',
    'mô phỏng luồng gói tin',
    'công cụ vẽ mạng online',
    'AI vẽ sơ đồ mạng',
    'DHCP',
    'Gateway',
    'DNS Server',
  ],
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: 'NetFlow Studio — Vẽ Sơ Đồ Mạng & Mô Phỏng Gói Tin',
    description:
      'Công cụ vẽ sơ đồ mạng trực quan bằng kéo thả cho người không chuyên, hỗ trợ xem luồng gói tin theo từng chặng và trợ lý AI thiết kế sơ đồ mạng tự động.',
    type: 'website',
    locale: 'vi_VN',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NetFlow Studio — Vẽ Sơ Đồ Mạng & Mô Phỏng Gói Tin',
    description:
      'Công cụ vẽ sơ đồ mạng trực quan bằng kéo thả cho người không chuyên, hỗ trợ xem luồng gói tin theo từng chặng và trợ lý AI thiết kế sơ đồ mạng tự động.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="vi"
      className={`${plusJakartaSans.variable} ${jetbrainsMono.variable}`}
    >
      <body
        className="font-sans bg-[#F8FAFC] text-slate-900 antialiased selection:bg-sky-100 selection:text-sky-900"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}

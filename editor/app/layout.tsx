import type { Metadata } from 'next';
import { Space_Grotesk } from 'next/font/google';
import './globals.css';
import React from 'react';
import ClientLayoutAddons from '@/components/client-layout-addons';

const spaceGrotesk = Space_Grotesk({
  variable: '--font-space-grotesk',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Smelter Editor',
  description: 'Smelter live demo application',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang='en'
      className={`dark bg-background ${spaceGrotesk.variable}`}>
      <body className='antialiased bg-background'>
        {children}
        <ClientLayoutAddons />
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import React from 'react';
import ClientLayoutAddons from '@/components/client-layout-addons';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
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
    <html lang='en' className='bg-[#161127]'>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[#161127]`}>
        {children}
        <ClientLayoutAddons />
      </body>
    </html>
  );
}

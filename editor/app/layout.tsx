import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ToastContainer } from 'react-toastify';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';
import React from 'react';
import { SpeechToText } from '@/components/speech-to-text';
import { SpeechToTextWithCommands } from '@/components/speech-to-text-with-commands';

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
        <SpeechToTextWithCommands />
        <ToastContainer />
        <Analytics />
      </body>
    </html>
  );
}

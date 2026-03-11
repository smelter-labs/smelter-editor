'use client';

import { createContext, useContext } from 'react';
import type { SmelterApiClient } from './api-client';

const SmelterApiContext = createContext<SmelterApiClient | null>(null);

export function SmelterApiProvider({
  client,
  children,
}: {
  client: SmelterApiClient;
  children: React.ReactNode;
}) {
  return (
    <SmelterApiContext.Provider value={client}>
      {children}
    </SmelterApiContext.Provider>
  );
}

export function useSmelterApi(): SmelterApiClient {
  const client = useContext(SmelterApiContext);
  if (!client) {
    throw new Error('useSmelterApi must be used within a SmelterApiProvider');
  }
  return client;
}

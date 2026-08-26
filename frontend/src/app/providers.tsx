'use client';

import type { ReactNode } from 'react';
import { SessionProvider } from 'next-auth/react';
import { Toaster } from 'sonner';

/**
 * Client-side context that has to wrap the whole tree.
 *
 * SessionProvider is what makes useSession() -- and therefore useApi() -- work
 * in client components. It lives in its own 'use client' file so the root
 * layout can stay a server component.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <Toaster position="top-right" richColors closeButton />
    </SessionProvider>
  );
}

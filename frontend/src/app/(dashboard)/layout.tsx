import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';

/**
 * Server-side session guard for every dashboard route.
 *
 * This is the real gate. src/proxy.ts also redirects unauthenticated requests,
 * but that is an optimistic cookie check running at the edge — the Next docs
 * are explicit that proxy is not an authorisation boundary. Checking here, on
 * the server, means a request that somehow reaches the route still cannot
 * render it without a session.
 *
 * A session with no backendToken is treated as no session: every API call the
 * page is about to make would 401, so bouncing to /login is the honest outcome.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  const session = await auth();

  if (!session?.backendToken) {
    redirect('/login');
  }

  return <AppShell>{children}</AppShell>;
}

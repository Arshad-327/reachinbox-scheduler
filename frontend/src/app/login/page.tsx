import type { Metadata } from 'next';

import { LoginCard } from './login-card';

export const metadata: Metadata = {
  title: 'Login · ReachInbox Scheduler',
};

/**
 * Server component purely so `?error=` can be read from searchParams and handed
 * down as a prop. Reading it client-side with useSearchParams() would drag a
 * Suspense boundary in for no benefit -- this page has nothing to stream.
 */
export default async function LoginPage(props: PageProps<'/login'>) {
  const params = await props.searchParams;
  const raw = params.error;
  const error = Array.isArray(raw) ? raw[0] : raw;

  return <LoginCard error={error} />;
}

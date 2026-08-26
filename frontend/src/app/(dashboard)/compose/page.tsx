import type { Metadata } from 'next';

import { ComposeForm } from '@/components/compose/ComposeForm';

export const metadata: Metadata = {
  title: 'Compose · ReachInbox Scheduler',
};

/**
 * A full page inside the dashboard shell, not a modal — the Figma shows a
 * dedicated view with its own back arrow. Sitting under (dashboard) means it
 * inherits the sidebar and the server-side session guard for free.
 */
export default function ComposePage() {
  return <ComposeForm />;
}

import type { Metadata } from 'next';

import { EmailView } from '@/components/email/EmailView';

export const metadata: Metadata = {
  title: 'Sent · ReachInbox Scheduler',
};

export default function SentPage() {
  return <EmailView variant="sent" />;
}

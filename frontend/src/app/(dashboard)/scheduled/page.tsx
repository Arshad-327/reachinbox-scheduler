import type { Metadata } from 'next';

import { EmailView } from '@/components/email/EmailView';

export const metadata: Metadata = {
  title: 'Scheduled · ReachInbox Scheduler',
};

export default function ScheduledPage() {
  return <EmailView variant="scheduled" />;
}

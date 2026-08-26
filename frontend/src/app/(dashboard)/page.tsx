import { redirect } from 'next/navigation';

/**
 * The dashboard has no combined view — "/" is just a doorway. Scheduled is the
 * landing view because it is the one that answers "what is about to happen".
 */
export default function DashboardIndexPage() {
  redirect('/scheduled');
}

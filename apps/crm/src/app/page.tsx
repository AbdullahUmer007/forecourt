import { redirect } from 'next/navigation';

/**
 * The dashboard is not built. Redirecting to the one screen that IS built is
 * more honest than a page of placeholder tiles that look like a product.
 */
export default function Home() {
  redirect('/appraisals');
}

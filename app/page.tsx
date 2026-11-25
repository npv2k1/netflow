import { NetworkStudio } from '@/components/network/NetworkStudio';
import { isGeminiConfigured } from '@/lib/network/ai-config';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const aiEnabled = isGeminiConfigured();
  return <NetworkStudio aiEnabled={aiEnabled} />;
}

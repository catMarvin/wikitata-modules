// Wikitata-side wrapper — proves compositor routes mount under /content-creation/*.
import { compositorRoutes } from '@/lib/cc';
export async function GET(req: Request) {
  return compositorRoutes.list.GET(req);
}

// Wikitata-side wrapper — proves package routes mount under /content-creation/*.
import { backdropRoutes } from '@/lib/cc';
export async function GET(req: Request) {
  return backdropRoutes.models.GET(req);
}

import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { personId: string } }
) {
  try {
    const resp = await fetch(`${API_URL}/api/investigators/${params.personId}/enrich-debug`, {
      cache: 'no-store',
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch enrichment debug trace' }, { status: 500 });
  }
}

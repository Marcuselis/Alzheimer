import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: { personId: string } }
) {
  try {
    const body = await request.json();
    const resp = await fetch(`${API_URL}/api/investigators/${params.personId}/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'Failed to queue enrichment' }, { status: 500 });
  }
}

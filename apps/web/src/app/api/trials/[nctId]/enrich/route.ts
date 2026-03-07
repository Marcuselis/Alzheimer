import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function POST(
  _request: Request,
  { params }: { params: { nctId: string } }
) {
  try {
    const resp = await fetch(`${API_URL}/api/trials/${params.nctId}/enrich`, {
      method: 'POST',
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json({ error: 'API unreachable' }, { status: 503 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const search = request.nextUrl.search || '';
    const resp = await fetch(`${API_URL}/api/news${search}`, {
      cache: 'no-store',
    });
    return NextResponse.json(await resp.json(), { status: resp.status });
  } catch {
    return NextResponse.json({ events: [], count: 0, error: 'Failed to fetch news' }, { status: 500 });
  }
}

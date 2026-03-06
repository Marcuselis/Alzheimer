import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function getApiBaseUrl(): string {
  const baseUrl =
    process.env.API_URL ||
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'http://localhost:3001';

  return baseUrl.replace(/\/$/, '');
}

export async function GET(request: NextRequest) {
  const upstreamUrl = `${getApiBaseUrl()}/api/literature/search${request.nextUrl.search}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });

    const text = await upstreamResponse.text();

    if (!text) {
      return new NextResponse(null, { status: upstreamResponse.status });
    }

    try {
      return NextResponse.json(JSON.parse(text), { status: upstreamResponse.status });
    } catch {
      return NextResponse.json(
        { error: 'Invalid response from API service', details: text.slice(0, 500) },
        { status: 502 }
      );
    }
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to reach API service', message: error?.message || 'Unknown error' },
      { status: 502 }
    );
  }
}

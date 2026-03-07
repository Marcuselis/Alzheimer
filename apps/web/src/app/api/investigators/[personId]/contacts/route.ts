import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { personId: string } }
) {
  try {
    const resp = await fetch(`${API_URL}/api/investigators/${params.personId}/contacts`, {
      cache: 'no-store',
    });
    return NextResponse.json(await resp.json());
  } catch {
    return NextResponse.json({ contacts: [], enrichmentStatus: { status: 'not_started', contactsFound: 0 } });
  }
}

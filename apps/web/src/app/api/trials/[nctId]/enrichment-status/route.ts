import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function GET(
  _request: Request,
  { params }: { params: { nctId: string } }
) {
  try {
    const resp = await fetch(`${API_URL}/api/trials/${params.nctId}/enrichment-status`, {
      next: { revalidate: 0 },
    });
    const data = await resp.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ job: null });
  }
}

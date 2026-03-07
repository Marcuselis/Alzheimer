import { NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function GET() {
  try {
    const resp = await fetch(`${API_URL}/api/admin/data-quality`, { next: { revalidate: 60 } });
    return NextResponse.json(await resp.json());
  } catch {
    return NextResponse.json({ error: 'Failed to load data quality stats' }, { status: 500 });
  }
}

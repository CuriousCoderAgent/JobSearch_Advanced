export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json({ key: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "" });
}

import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

type RevalidateDocBody = {
  slug?: string;
};

export async function POST(request: Request) {
  const expectedSecret = process.env.REVALIDATE_SECRET;
  const providedSecret = request.headers.get("x-revalidate-secret");

  if (!expectedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: RevalidateDocBody;
  try {
    body = (await request.json()) as RevalidateDocBody;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!slug) {
    return NextResponse.json({ success: false, error: "Missing slug" }, { status: 400 });
  }

  revalidatePath(`/doc/${slug}`);

  return NextResponse.json({
    success: true,
    revalidated: [`/doc/${slug}`],
  });
}

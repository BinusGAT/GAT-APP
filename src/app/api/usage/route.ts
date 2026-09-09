import { NextResponse } from "next/server";
import { recordApplicationOpen } from "@/lib/actions";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const buttonId = Number(body?.buttonId);

    if (Number.isInteger(buttonId) && buttonId > 0) {
      await recordApplicationOpen(buttonId);
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error("Failed to record application open:", error);
    return NextResponse.json({ success: false }, { status: 400 });
  }
}

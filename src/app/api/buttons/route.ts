import { NextResponse } from "next/server";
import { getButtons } from "@/lib/actions";

export async function GET() {
  try {
    const buttons = await getButtons();
    return NextResponse.json(buttons);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load buttons.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getButtons } from "@/lib/actions";

export async function GET() {
  try {
    const buttons = await getButtons();
    return NextResponse.json(buttons);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

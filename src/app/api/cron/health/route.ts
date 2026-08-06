import { NextRequest, NextResponse } from "next/server";
import { runScheduledHealthChecks } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const secret = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const result = await runScheduledHealthChecks(secret);
  return NextResponse.json(result, { status: result.success ? 200 : 401 });
}

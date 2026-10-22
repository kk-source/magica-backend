import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const corsHeaders = {
  "Access-Control-Allow-Origin": process.env.FRONTEND_ORIGIN ?? "http://localhost:3000",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key",
  "Access-Control-Allow-Credentials": "true",
};

export default clerkMiddleware(async (auth, req) => {
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: corsHeaders });

  const { userId } = await auth();
  const res = userId ? NextResponse.next() : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
});

export const config = { matcher: ["/api/:path*"] };

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { buildAppState, buildPublicState } from "@/lib/state";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(await buildPublicState());
    }

    return NextResponse.json(await buildAppState(user));
  } catch (error) {
    console.error("Unable to load state", error);
    return NextResponse.json({ error: "Unable to load game state." }, { status: 500 });
  }
}

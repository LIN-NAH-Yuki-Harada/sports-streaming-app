import { AccessToken } from "livekit-server-sdk";

export async function POST(request: Request) {
  const { roomName, participantIdentity, participantName, role } =
    await request.json();

  if (!roomName || !participantIdentity) {
    return Response.json(
      { error: "roomName and participantIdentity are required" },
      { status: 400 }
    );
  }

  const token = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: participantIdentity,
      name: participantName || participantIdentity,
      ttl: role === "broadcaster" ? "8h" : "6h",
    }
  );

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: role === "broadcaster",
    canSubscribe: true,
  });

  const jwt = await token.toJwt();

  return Response.json({ token: jwt });
}

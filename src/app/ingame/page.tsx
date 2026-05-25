import InGameClient from "./InGameClient";

export default async function InGamePage({
  searchParams
}: {
  searchParams: Promise<{ gameId?: string }>;
}) {
  const params = await searchParams;
  return <InGameClient gameId={params.gameId || ""} />;
}

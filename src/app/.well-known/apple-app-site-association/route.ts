export async function GET() {
  return new Response(
    JSON.stringify({
      applinks: {
        apps: [],
        details: [
          {
            appIDs: ["TEAMID.ai.dividimos.app"],
            paths: ["/auth/native-complete*"],
          },
        ],
      },
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    },
  );
}

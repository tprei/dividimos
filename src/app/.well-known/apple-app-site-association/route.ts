// Same paths as the autoVerify intent filters in AndroidManifest.xml, never a
// wildcard. A wrong App ID prefix would break the association on every
// installed device, so an unusable prefix serves 404 instead of a bogus appID.

const APP_ID_PREFIX_RE = /^[A-Z0-9]{10}$/;
const BUNDLE_ID = "ai.dividimos.app";

const COMPONENTS = [{ "/": "/join/*" }, { "/": "/claim" }, { "/": "/u/*" }, { "/": "/room/*" }];

export function GET() {
  const prefix = process.env.APPLE_APP_ID_PREFIX;
  if (!prefix || !APP_ID_PREFIX_RE.test(prefix)) {
    return new Response(null, { status: 404 });
  }

  return Response.json({
    applinks: {
      details: [
        {
          appIDs: [`${prefix}.${BUNDLE_ID}`],
          components: COMPONENTS,
        },
      ],
    },
  });
}

export async function GET() {
  return Response.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: "ai.dividimos.app",
        sha256_cert_fingerprints: [
          "1C:37:76:4C:D3:32:BA:45:EA:CD:B4:BB:FE:FC:A4:4F:01:91:8C:68:49:5C:0E:3A:E1:C5:CF:0A:0D:74:01:3C",
        ],
      },
    },
  ]);
}

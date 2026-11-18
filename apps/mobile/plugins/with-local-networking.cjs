const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require("expo/config-plugins");

const networkConfig = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain>127.0.0.1</domain>
    <domain>localhost</domain>
  </domain-config>
</network-security-config>
`;

module.exports = function withLocalNetworking(config) {
  config = withAndroidManifest(config, (mod) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    app.$["android:networkSecurityConfig"] = "@xml/cospace_network_security";
    return mod;
  });
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      const xmlDir = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res/xml",
      );
      await mkdir(xmlDir, { recursive: true });
      await writeFile(
        path.join(xmlDir, "cospace_network_security.xml"),
        networkConfig,
      );
      return mod;
    },
  ]);
};

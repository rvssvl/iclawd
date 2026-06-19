const fs = require('fs');
const path = require('path');
const { withDangerousMod, withPlugins } = require('@expo/config-plugins');
const rnFirebaseAppRoot = path.dirname(require.resolve('@react-native-firebase/app/package.json'));
const { withFirebaseAppDelegate, withIosGoogleServicesFile } = require(path.join(rnFirebaseAppRoot, 'plugin/build/ios'));
const {
  withApplyGoogleServicesPlugin,
  withBuildscriptDependency,
  withCopyAndroidGoogleServices,
} = require(path.join(rnFirebaseAppRoot, 'plugin/build/android'));

module.exports = function withOptionalFirebase(config) {
  const projectRoot = process.cwd();
  const plugins = [];

  if (config.ios?.googleServicesFile && fs.existsSync(path.resolve(projectRoot, config.ios.googleServicesFile))) {
    plugins.push(withFirebaseAppDelegate, withIosGoogleServicesFile, withFirebasePodfileSettings);
  } else {
    console.warn('[with-optional-firebase] Missing iOS GoogleService-Info.plist; Firebase iOS native config skipped.');
  }

  if (config.android?.googleServicesFile && fs.existsSync(path.resolve(projectRoot, config.android.googleServicesFile))) {
    plugins.push(withBuildscriptDependency, withApplyGoogleServicesPlugin, withCopyAndroidGoogleServices);
  } else {
    console.warn('[with-optional-firebase] Missing Android google-services.json; Firebase Android native config skipped.');
  }

  return withPlugins(config, plugins);
};

function withFirebasePodfileSettings(config) {
  return withDangerousMod(config, [
    'ios',
    async (config) => {
      const podfilePath = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        return config;
      }

      let source = fs.readFileSync(podfilePath, 'utf8');

      if (!source.includes('$RNFirebaseAnalyticsWithoutAdIdSupport')) {
        source = source.replace(
          /(platform :ios, .+\n)/,
          `$1$RNFirebaseAnalyticsWithoutAdIdSupport = true\n`
        );
      }

      if (!source.includes('use_modular_headers!')) {
        source = source.replace(
          /(prepare_react_native_project!\n)/,
          `$1\nuse_modular_headers!\n`
        );
      }

      fs.writeFileSync(podfilePath, source);
      return config;
    },
  ]);
}

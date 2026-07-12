const fs = require('fs');
const path = require('path');
const { withDangerousMod, withFinalizedMod, withPlugins } = require('@expo/config-plugins');
const rnFirebaseAppRoot = path.dirname(require.resolve('@react-native-firebase/app/package.json'));
const { withFirebaseAppDelegate, withIosGoogleServicesFile } = require(path.join(rnFirebaseAppRoot, 'plugin/build/ios'));
const {
  withApplyGoogleServicesPlugin,
  withBuildscriptDependency,
  withCopyAndroidGoogleServices,
} = require(path.join(rnFirebaseAppRoot, 'plugin/build/android'));

function withOptionalFirebase(config) {
  const projectRoot = process.cwd();
  const plugins = [];
  let hasIosFirebase = false;

  if (config.ios?.googleServicesFile && fs.existsSync(path.resolve(projectRoot, config.ios.googleServicesFile))) {
    hasIosFirebase = true;
    plugins.push(withFirebaseAppDelegate, withIosGoogleServicesFile, withFirebasePodfileSettings);
  } else {
    console.warn('[with-optional-firebase] Missing iOS GoogleService-Info.plist; Firebase iOS native config skipped.');
  }

  if (config.android?.googleServicesFile && fs.existsSync(path.resolve(projectRoot, config.android.googleServicesFile))) {
    plugins.push(withBuildscriptDependency, withApplyGoogleServicesPlugin, withCopyAndroidGoogleServices);
  } else {
    console.warn('[with-optional-firebase] Missing Android google-services.json; Firebase Android native config skipped.');
  }

  config = withPlugins(config, plugins);
  return hasIosFirebase ? withSceneSafeFirebaseInitialization(config) : config;
}

function withSceneSafeFirebaseInitialization(config) {
  return withFinalizedMod(config, [
    'ios',
    async (config) => {
      const appDelegatePath = path.join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName,
        'AppDelegate.swift'
      );
      if (!fs.existsSync(appDelegatePath)) {
        return config;
      }

      const source = fs.readFileSync(appDelegatePath, 'utf8');
      fs.writeFileSync(appDelegatePath, makeSceneSafeFirebaseInitialization(source));
      return config;
    },
  ]);
}

function makeSceneSafeFirebaseInitialization(source) {
  const generatedConfigureBlock = /\n?\/\/ @generated begin @react-native-firebase\/app-didFinishLaunchingWithOptions[^\n]*\n\s*FirebaseApp\.configure\(\)\n\/\/ @generated end @react-native-firebase\/app-didFinishLaunchingWithOptions[^\n]*\n?/g;
  let next = source.replace(generatedConfigureBlock, '\n');
  const anchor = '    bindReactNativeFactory(factory)\n';
  const sceneSafeInitialization = `${anchor}\n    // Firebase must initialize before the scene-manifest early return used by CarPlay.\n    if FirebaseApp.app() == nil {\n      FirebaseApp.configure()\n    }\n`;

  if (!next.includes('Firebase must initialize before the scene-manifest early return')) {
    if (!next.includes(anchor)) {
      throw new Error('[with-optional-firebase] Could not locate the React Native factory binding in AppDelegate.swift.');
    }
    next = next.replace(anchor, sceneSafeInitialization);
  }
  return next;
}

module.exports = withOptionalFirebase;
module.exports.makeSceneSafeFirebaseInitialization = makeSceneSafeFirebaseInitialization;

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

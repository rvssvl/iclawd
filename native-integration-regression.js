const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  makeSceneSafeFirebaseInitialization,
} = require('./plugins/with-optional-firebase');

const appDelegateFixture = `
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    if Bundle.main.object(forInfoDictionaryKey: "UIApplicationSceneManifest") != nil {
      return super.application(application, didFinishLaunchingWithOptions: launchOptions)
    }

// @generated begin @react-native-firebase/app-didFinishLaunchingWithOptions - expo prebuild
FirebaseApp.configure()
// @generated end @react-native-firebase/app-didFinishLaunchingWithOptions
    factory.startReactNative(
`;

const fixedAppDelegate = makeSceneSafeFirebaseInitialization(appDelegateFixture);
const configureIndex = fixedAppDelegate.indexOf('FirebaseApp.configure()');
const sceneReturnIndex = fixedAppDelegate.indexOf('UIApplicationSceneManifest');
assert.ok(configureIndex >= 0, 'Firebase initialization should exist');
assert.ok(configureIndex < sceneReturnIndex, 'Firebase must initialize before the scene early return');
assert.equal(
  fixedAppDelegate.match(/FirebaseApp\.configure\(\)/g)?.length,
  1,
  'Firebase should initialize exactly once',
);

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const installedCamera = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'node_modules/expo-camera/package.json'), 'utf8'),
);
assert.match(packageJson.dependencies['expo-camera'], /^~17\./, 'Expo 54 must use expo-camera 17.x');
assert.match(installedCamera.version, /^17\./, 'Installed expo-camera must match Expo 54');

console.log('native integration regression tests passed');

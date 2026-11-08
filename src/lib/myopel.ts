// How the dashboard's "Open myOpel" button (shown after Preheat) gets from
// this web app into Opel's own myOpel app. Pure strings/functions, no React
// or "server-only" import, so it's unit-testable.
//
// Tested on real phones (Nov 2026) with a temporary link test page:
// - iOS (Safari tab and home-screen app): the plain https link to myOpel's
//   deep-link domain is a Universal Link and opens myOpel directly, with no
//   prompt. iOS is the priority platform for this household.
// - Android (Chrome): an intent URL pinned to that same https address and to
//   myOpel's package opens the app even from fully closed. myOpel seemed to
//   crash at times after opening this way -- looked like the app's own
//   problem, accepted as good enough. The plain https link does NOT work on
//   Android: the domain isn't verified/enabled on the device by default, so
//   Chrome loads it and the server returns an "access denied" XML page.
// - Ruled out: launching myOpel by package name alone (Chrome falls through
//   to the Play Store because myOpel's launcher screen isn't web-openable),
//   and its "mymopsdk://" custom scheme -- that's the app's OAuth redirect
//   receiver, which on Android only works while myOpel is already running.
//   On iOS it does open the app, but behind an "Open in My Opel?" prompt.
//
// Where the identifiers come from: the package name is on the Play Store
// listing; the deep-link domain is listed under myOpel's "Open by default"
// settings on Android, and its /.well-known/apple-app-site-association
// claims every path ("*") for the iOS myOpel app. None of this is documented
// by Opel/Stellantis, so if the button stops working after a myOpel update,
// re-check that file and the Android supported-links list first.

export const MYOPEL_ANDROID_PACKAGE = "com.psa.mym.myopel";
export const MYOPEL_DEEPLINK_HOST = "deeplink-op.mym.awsmpsa.com";

export const MYOPEL_APP_STORE_URL = "https://apps.apple.com/app/id1439342035";
export const MYOPEL_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${MYOPEL_ANDROID_PACKAGE}`;

// iOS Universal Link. If myOpel isn't installed, iOS just loads the address
// in the browser, which shows the server's "access denied" page -- acceptable
// here since the household has the app.
export const MYOPEL_DEEPLINK_URL = `https://${MYOPEL_DEEPLINK_HOST}/`;

// Android Chrome "intent:" URL for the deep-link address, pinned to the
// myOpel package so it opens the app even though the domain isn't verified
// on the device. With a fallbackUrl, Chrome goes there if myOpel isn't
// installed; without one, nothing happens in that case.
export function myOpelAndroidDeepLinkIntent(fallbackUrl?: string): string {
  const parts = ["scheme=https", "action=android.intent.action.VIEW", `package=${MYOPEL_ANDROID_PACKAGE}`];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent://${MYOPEL_DEEPLINK_HOST}/#Intent;${parts.join(";")};end`;
}

export type MyOpelPlatform = "android" | "ios" | "other";

// iPadOS Safari reports a desktop "Macintosh" user agent, so a Mac UA with a
// touchscreen is treated as iOS.
export function detectMyOpelPlatform(userAgent: string, maxTouchPoints = 0): MyOpelPlatform {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "ios";
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "other";
}

// The link the "Open myOpel" button uses, per platform (see the test results
// at the top of this file). Desktop gets the store page, since neither app
// link can work there.
export function myOpelOpenUrl(platform: MyOpelPlatform): string {
  switch (platform) {
    case "android":
      return myOpelAndroidDeepLinkIntent(MYOPEL_PLAY_STORE_URL);
    case "ios":
      return MYOPEL_DEEPLINK_URL;
    default:
      return MYOPEL_APP_STORE_URL;
  }
}

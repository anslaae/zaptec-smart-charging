// How to get from this web app into Opel's own myOpel app. Kept free of any
// React/"server-only" import so both the dashboard and the /debug/opel test
// page can share the exact same strings.
//
// What's known (verified, not guessed):
// - Android package com.psa.mym.myopel (Play Store listing).
// - Custom scheme "mymopsdk" (flobz/psa_car_controller's brand table). It's
//   myOpel's OAuth *redirect* receiver, not a general "open the app" entry:
//   tested on Android it only brings myOpel forward if it's already running,
//   and flashes back to the browser from a cold start. On iOS, a plain
//   mymopsdk:// link shows an "Open in My Opel?" prompt and opens the app.
// - Deep-link domain deeplink-op.mym.awsmpsa.com (listed under myOpel's
//   "Open by default" -> supported links on Android). Its
//   /.well-known/apple-app-site-association claims every path ("*") for the
//   iOS app, and its /.well-known/assetlinks.json names com.psa.mym.myopel --
//   but on the tested Android phone the link is NOT verified/enabled by
//   default, so a plain https link stays in the browser there. An Android
//   intent URL that names the package explicitly sidesteps that.

export const MYOPEL_ANDROID_PACKAGE = "com.psa.mym.myopel";
export const MYOPEL_URL_SCHEME = "mymopsdk";
export const MYOPEL_DEEPLINK_HOST = "deeplink-op.mym.awsmpsa.com";

export const MYOPEL_APP_STORE_URL = "https://apps.apple.com/app/id1439342035";
export const MYOPEL_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${MYOPEL_ANDROID_PACKAGE}`;

// Plain https deep link. On iOS this is a Universal Link (opens myOpel
// directly when tapped from another site); on Android it only opens the app
// if the user has enabled the domain under myOpel's "Open by default".
export const MYOPEL_DEEPLINK_URL = `https://${MYOPEL_DEEPLINK_HOST}/`;

// Plain custom-scheme URL -- confirmed to open myOpel on iOS (after a prompt).
export const MYOPEL_SCHEME_URL = `${MYOPEL_URL_SCHEME}://`;

function intentUrl(hostAndPath: string, extras: string[], fallbackUrl?: string): string {
  const parts = [...extras, `package=${MYOPEL_ANDROID_PACKAGE}`];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent://${hostAndPath}#Intent;${parts.join(";")};end`;
}

// Android Chrome "intent:" URL for the https deep-link domain, pinned to the
// myOpel package so it opens the app even though the domain isn't verified
// on the device. With a fallbackUrl, Chrome goes there if myOpel isn't
// installed; without one, nothing happens in that case.
export function myOpelAndroidDeepLinkIntent(fallbackUrl?: string): string {
  return intentUrl(`${MYOPEL_DEEPLINK_HOST}/`, ["scheme=https", "action=android.intent.action.VIEW"], fallbackUrl);
}

// Android Chrome "intent:" URL for the mymopsdk scheme, pinned to the myOpel
// package. Kept only as a comparison: it works only while myOpel is running.
export function myOpelAndroidSchemeIntent(fallbackUrl?: string): string {
  return intentUrl("", [`scheme=${MYOPEL_URL_SCHEME}`], fallbackUrl);
}

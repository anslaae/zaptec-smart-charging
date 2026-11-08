// How to get from this web app into Opel's own myOpel app. Kept free of any
// React/"server-only" import so both the dashboard and the /debug/opel test
// page can share the exact same strings.
//
// Identifiers verified against the myOpel store listings and the open-source
// psa_car_controller project's brand table (flobz/psa_car_controller,
// psa/constants.py): Opel's Android package is com.psa.mym.myopel and the app
// registers the custom URL scheme "mymopsdk" (used there for its OAuth
// redirect). Neither is documented by Opel/Stellantis, so treat the scheme as
// "observed to exist", not a stable contract -- which is what /debug/opel is
// for: confirming on a real phone which of these actually opens the app.

export const MYOPEL_ANDROID_PACKAGE = "com.psa.mym.myopel";
export const MYOPEL_URL_SCHEME = "mymopsdk";

export const MYOPEL_APP_STORE_URL = "https://apps.apple.com/app/id1439342035";
export const MYOPEL_PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${MYOPEL_ANDROID_PACKAGE}`;

// Android Chrome "intent:" URL that launches the app's main (launcher)
// activity by package name. With a fallbackUrl, Chrome goes there instead
// when the app isn't installed; without one, it does nothing in that case.
export function myOpelAndroidLauncherIntent(fallbackUrl?: string): string {
  const parts = [
    `package=${MYOPEL_ANDROID_PACKAGE}`,
    "action=android.intent.action.MAIN",
    "category=android.intent.category.LAUNCHER",
  ];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent://#Intent;${parts.join(";")};end`;
}

// Android Chrome "intent:" URL that opens the app through its custom scheme,
// restricted to the myOpel package.
export function myOpelAndroidSchemeIntent(fallbackUrl?: string): string {
  const parts = [`scheme=${MYOPEL_URL_SCHEME}`, `package=${MYOPEL_ANDROID_PACKAGE}`];
  if (fallbackUrl) parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  return `intent://#Intent;${parts.join(";")};end`;
}

// Plain custom-scheme URL -- the only candidate that can work on iOS too.
export const MYOPEL_SCHEME_URL = `${MYOPEL_URL_SCHEME}://`;

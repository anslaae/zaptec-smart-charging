import { describe, expect, it } from "vitest";
import {
  MYOPEL_APP_STORE_URL,
  MYOPEL_DEEPLINK_URL,
  detectMyOpelPlatform,
  myOpelAndroidDeepLinkIntent,
  myOpelOpenUrl,
} from "./myopel";

const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1";
// iPadOS Safari defaults to a desktop-class UA.
const IPAD_DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15";
const WINDOWS_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";

describe("detectMyOpelPlatform", () => {
  it("detects Android", () => {
    expect(detectMyOpelPlatform(ANDROID_CHROME, 5)).toBe("android");
  });

  it("detects iPhone", () => {
    expect(detectMyOpelPlatform(IPHONE_SAFARI, 5)).toBe("ios");
  });

  it("treats a touchscreen Mac UA as iPadOS", () => {
    expect(detectMyOpelPlatform(IPAD_DESKTOP_UA, 5)).toBe("ios");
  });

  it("treats a real (non-touch) Mac as other", () => {
    expect(detectMyOpelPlatform(IPAD_DESKTOP_UA, 0)).toBe("other");
  });

  it("treats Windows desktop as other", () => {
    expect(detectMyOpelPlatform(WINDOWS_CHROME, 0)).toBe("other");
  });
});

describe("myOpelOpenUrl", () => {
  it("uses the package-pinned deep-link intent with a Play Store fallback on Android", () => {
    const url = myOpelOpenUrl("android");
    expect(url).toBe(
      "intent://deeplink-op.mym.awsmpsa.com/#Intent;scheme=https;action=android.intent.action.VIEW;" +
        "package=com.psa.mym.myopel;" +
        "S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.psa.mym.myopel;end",
    );
  });

  it("uses the plain https deep link (Universal Link) on iOS", () => {
    expect(myOpelOpenUrl("ios")).toBe(MYOPEL_DEEPLINK_URL);
    expect(MYOPEL_DEEPLINK_URL).toBe("https://deeplink-op.mym.awsmpsa.com/");
  });

  it("falls back to the store page elsewhere", () => {
    expect(myOpelOpenUrl("other")).toBe(MYOPEL_APP_STORE_URL);
  });

  it("leaves the intent without a fallback when none is given", () => {
    expect(myOpelAndroidDeepLinkIntent()).not.toContain("browser_fallback_url");
  });
});
